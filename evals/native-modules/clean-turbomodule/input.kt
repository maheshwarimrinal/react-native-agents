// android/src/main/java/com/example/storage/SecureStorageModule.kt
//
// A correctly written TurboModule. Nothing here should be reported.
package com.example.storage

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import java.util.concurrent.Executors

@ReactModule(name = SecureStorageModule.NAME)
class SecureStorageModule(reactContext: ReactApplicationContext) :
  NativeSecureStorageSpec(reactContext) {

  override fun getName() = NAME

  // Bounded, owned by the instance, shut down in invalidate(). A thread per
  // call would let a fast caller exhaust the device.
  private val executor = Executors.newFixedThreadPool(2)

  private val prefs by lazy {
    val key = MasterKey.Builder(reactApplicationContext)
      .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
      .build()
    EncryptedSharedPreferences.create(
      reactApplicationContext,
      "secure_store",
      key,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
  }

  // Synchronous is acceptable here: an in-memory read of an already-open
  // preferences handle. Anything touching disk or network gets a Promise.
  override fun isAvailable(): Boolean = true

  override fun setItem(key: String, value: String, promise: Promise) {
    executor.execute {
      try {
        prefs.edit().putString(key, value).apply()
        promise.resolve(null)
      } catch (e: Exception) {
        // A code the JS side can branch on, not just a message.
        promise.reject("E_STORAGE_WRITE_FAILED", e.message, e)
      }
    }
  }

  override fun getItem(key: String, promise: Promise) {
    executor.execute {
      try {
        promise.resolve(prefs.getString(key, null))
      } catch (e: Exception) {
        promise.reject("E_STORAGE_READ_FAILED", e.message, e)
      }
    }
  }

  override fun removeItem(key: String, promise: Promise) {
    executor.execute {
      try {
        prefs.edit().remove(key).apply()
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("E_STORAGE_DELETE_FAILED", e.message, e)
      }
    }
  }

  override fun invalidate() {
    // Called on reload and teardown; without this every dev reload leaks a pool.
    executor.shutdownNow()
    super.invalidate()
  }

  companion object {
    const val NAME = "SecureStorage"
  }
}
