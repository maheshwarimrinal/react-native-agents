/**
 * Anonymous, opt-in adoption telemetry.
 *
 * Design constraints, in priority order:
 *
 * 1. **Off unless the user turned it on.** No first-run prompt that defaults to
 *    yes, no "we'll assume consent". `isEnabled()` returns false until someone
 *    runs `telemetry enable`. This package ships agents that tell people consent
 *    precedes collection; it would be indefensible to do otherwise here.
 *
 * 2. **No personally identifying data, ever.** Not paths, not repository names,
 *    not project names, not package names, not usernames, not code, not error
 *    messages. The allowed fields are enumerated in ALLOWED_PROPERTIES below and
 *    enforced by `sanitise()` — anything not on the list is dropped rather than
 *    trusted to callers.
 *
 * 3. **Zero dependencies.** PostHog's capture endpoint is a plain HTTPS POST, so
 *    there is no reason to pull an SDK and break the no-dependency property that
 *    the rest of this package maintains.
 *
 * 4. **Never affects the user's command.** Fire-and-forget, hard timeout, all
 *    errors swallowed. Telemetry that can slow down or fail `npx install` is
 *    worse than no telemetry.
 *
 * 5. **A missing key is a no-op**, so a fork or a local checkout sends nothing
 *    even if a user opts in.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';

import { VERSION } from './source.mjs';

/**
 * PostHog project API key. This is a *write-only* public key by design — it can
 * submit events and cannot read them — which is why it is safe to ship.
 *
 * It is committed on purpose. This package is published to npm, so the key
 * travels inside the tarball regardless of what the repository does — keeping it
 * out of git would be false comfort, not security. See TELEMETRY.md.
 *
 * RN_AGENTS_POSTHOG_KEY overrides it for local testing. If it is ever empty
 * (a fork, a stripped build), telemetry is a no-op no matter what the user has
 * consented to.
 */
const POSTHOG_KEY =
	process.env.RN_AGENTS_POSTHOG_KEY ??
	'phc_oS7RWLb2oab3AYERhpHrroNSenBycje4Ft2q46iAssbX';

/**
 * EU cloud by default. The events carry no personal data either way, but
 * keeping them in the EU is the lower-friction answer if a European user ever
 * asks where their (non-personal) usage pings are processed.
 */
const POSTHOG_HOST = process.env.RN_AGENTS_POSTHOG_HOST ?? 'eu.i.posthog.com';

const TIMEOUT_MS = 1500;

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

function configDir() {
	// XDG on Linux, Application Support on macOS, APPDATA on Windows.
	if (process.env.XDG_CONFIG_HOME) {
		return path.join(process.env.XDG_CONFIG_HOME, 'react-native-agents');
	}
	if (process.platform === 'darwin') {
		return path.join(
			os.homedir(),
			'Library',
			'Application Support',
			'react-native-agents',
		);
	}
	if (process.platform === 'win32' && process.env.APPDATA) {
		return path.join(process.env.APPDATA, 'react-native-agents');
	}
	return path.join(os.homedir(), '.config', 'react-native-agents');
}

const CONFIG_FILE = path.join(configDir(), 'config.json');

export function readConfig() {
	try {
		return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
	} catch {
		return {};
	}
}

function writeConfig(next) {
	try {
		fs.mkdirSync(configDir(), { recursive: true });
		fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`);
		return true;
	} catch {
		return false;
	}
}

/**
 * A random identifier for this installation.
 *
 * Deliberately random rather than derived from anything about the machine — no
 * hostname hash, no MAC address, no home directory. It exists only so repeat
 * runs from one install are not counted as many installs, and deleting the
 * config file makes it a new one. It cannot be traced back to a person or a
 * machine, by us or by anyone reading the data.
 */
function installId(config) {
	if (config.installId) return config.installId;
	const id = crypto.randomUUID();
	writeConfig({ ...config, installId: id });
	return id;
}

/* ------------------------------------------------------------------ *
 * Consent
 * ------------------------------------------------------------------ */

/**
 * Resolution order, most explicit first. Any signal that says "no" wins — there
 * is no combination of settings where a disable is overridden by an enable.
 */
/**
 * Pure consent logic, independent of whether this build can actually send.
 *
 * Split out deliberately: when the key is unset, `telemetryState` short-circuits
 * before reaching any of this, so a test asserting "DO_NOT_TRACK beats an
 * opt-in" against `telemetryState` would pass without ever exercising the rule
 * it claims to check. Testing consent here makes the assertion mean something.
 */
export function consentState(env = process.env, config = readConfig()) {
	// Cross-tool convention. Honoured unconditionally.
	if (env.DO_NOT_TRACK === '1' || env.DO_NOT_TRACK === 'true') {
		return { enabled: false, reason: 'DO_NOT_TRACK is set' };
	}

	if (
		env.RN_AGENTS_TELEMETRY === '0' ||
		env.RN_AGENTS_TELEMETRY === 'false'
	) {
		return { enabled: false, reason: 'RN_AGENTS_TELEMETRY=0' };
	}
	if (env.RN_AGENTS_TELEMETRY === '1' || env.RN_AGENTS_TELEMETRY === 'true') {
		return { enabled: true, reason: 'RN_AGENTS_TELEMETRY=1' };
	}

	if (config.telemetry === true)
		return { enabled: true, reason: 'enabled in config' };
	if (config.telemetry === false)
		return { enabled: false, reason: 'disabled in config' };

	// The default. Opt-in means opt-in.
	return { enabled: false, reason: 'not enabled (opt-in)' };
}

/**
 * Consent AND the ability to send. This is what callers should use.
 */
export function telemetryState(env = process.env, config = readConfig()) {
	const consent = consentState(env, config);
	if (!consent.enabled) return consent;
	if (!POSTHOG_KEY)
		return { enabled: false, reason: 'not configured in this build' };
	return consent;
}

export function setTelemetry(enabled) {
	const config = readConfig();
	return writeConfig({ ...config, telemetry: Boolean(enabled) });
}

/** Records that the informational notice has been shown, so it appears once. */
export function writeNoticeShown(config = readConfig()) {
	return writeConfig({ ...config, telemetryNoticeShown: true });
}

export { CONFIG_FILE };

/* ------------------------------------------------------------------ *
 * Payload
 * ------------------------------------------------------------------ */

/**
 * The complete set of properties this package will ever send.
 *
 * Anything a caller passes that is not on this list is dropped. That inverts
 * the usual risk: a future contributor adding `capture('x', { projectName })`
 * silently sends nothing rather than silently leaking.
 */
export const ALLOWED_PROPERTIES = new Set([
	'surface', // 'cli' | 'mcp' | 'action'
	'command', // 'install' | 'size' | 'list' | 'audit'  (fixed vocabulary, never user input)
	'tool', // 'claude-code' | 'cursor' | 'windsurf' | 'copilot' | 'agents-md' | 'all'
	'agent_id', // 'rn-performance' etc — ids from this repo, never user strings
	'agent_count', // number
	'version', // this package's version
	'node_major', // 20 | 22 | 24
	'os', // 'darwin' | 'linux' | 'win32'
	'ci', // boolean — is this an automated environment
]);

export function sanitise(properties = {}) {
	const out = {};
	for (const [key, value] of Object.entries(properties)) {
		if (!ALLOWED_PROPERTIES.has(key)) continue;
		if (value === undefined || value === null) continue;
		// Only primitives. No objects, no arrays — nothing that can carry a payload.
		if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
		// Belt and braces: a string that looks like a path or an email never ships,
		// even if someone adds its key to the allow-list later.
		if (typeof value === 'string' && /[/\\@]|\.\.|^[A-Za-z]:/.test(value))
			continue;
		out[key] = value;
	}
	return out;
}

function baseProperties() {
	return {
		version: VERSION,
		node_major: Number(process.versions.node.split('.')[0]),
		os: process.platform,
		ci: Boolean(process.env.CI),
		// Suppresses PostHog's IP-based geolocation. An IP address is personal data
		// under GDPR, and we have no use for it.
		$ip: null,
		// No person profile — these are anonymous events, not identified users.
		$process_person_profile: false,
	};
}

/* ------------------------------------------------------------------ *
 * Send
 * ------------------------------------------------------------------ */

/**
 * Fire-and-forget. Resolves to a boolean for tests; callers should not await it
 * in a way that can delay their command.
 */
export function capture(event, properties = {}, { env = process.env } = {}) {
	const state = telemetryState(env);
	if (!state.enabled) return Promise.resolve(false);

	const config = readConfig();
	const body = JSON.stringify({
		api_key: POSTHOG_KEY,
		event,
		distinct_id: installId(config),
		timestamp: new Date().toISOString(),
		properties: { ...baseProperties(), ...sanitise(properties) },
	});

	return new Promise((resolve) => {
		let settled = false;
		const done = (value) => {
			if (!settled) {
				settled = true;
				resolve(value);
			}
		};

		try {
			const req = https.request(
				{
					hostname: POSTHOG_HOST,
					// PostHog's current primary capture endpoint. The older `/capture/`
					// still works but the docs now point here.
					path: '/i/v0/e/',
					method: 'POST',
					timeout: TIMEOUT_MS,
					headers: {
						'Content-Type': 'application/json',
						'Content-Length': Buffer.byteLength(body),
					},
				},
				(res) => {
					res.resume(); // drain, we do not care about the response
					done(res.statusCode !== undefined && res.statusCode < 400);
				},
			);

			req.on('error', () => done(false));
			req.on('timeout', () => {
				req.destroy();
				done(false);
			});
			req.write(body);
			req.end();
		} catch {
			done(false);
		}

		// Hard ceiling regardless of socket behaviour.
		const timer = setTimeout(() => done(false), TIMEOUT_MS);
		timer.unref?.();
	});
}

/**
 * Detach the process from the request so a slow network cannot hold the CLI
 * open. Node will exit with the socket in flight; the event is best-effort.
 */
export function captureDetached(event, properties) {
	try {
		void capture(event, properties);
	} catch {
		/* never surfaces to the user */
	}
}
