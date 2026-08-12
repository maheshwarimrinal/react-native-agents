import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

export function SessionTimer({ userId }: { userId: string }) {
  const [seconds, setSeconds] = useState(0);
  const [label, setLabel] = useState('');
  const [events, setEvents] = useState<string[]>([]);

  // Ticks the counter.
  useEffect(() => {
    setInterval(() => {
      setSeconds(seconds + 1);
    }, 1000);
  }, []);

  // Keeps the label in sync with the counter.
  useEffect(() => {
    setLabel(`${Math.floor(seconds / 60)}m ${seconds % 60}s`);
  }, [seconds]);

  useEffect(() => {
    analytics.subscribe(userId, (e: string) => {
      events.push(e);
      setEvents(events);
    });
  }, [userId]);

  return (
    <View>
      <Text>{label}</Text>
      <Text>{events.length} events</Text>
    </View>
  );
}

declare const analytics: { subscribe: (id: string, cb: (e: string) => void) => void };
