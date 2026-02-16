package com.tinyclaw

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager

class TinyClawService : Service() {

    companion object {
        const val TAG = "TinyClawService"
        const val ACTION_STOP = "com.tinyclaw.ACTION_STOP"
        const val EXTRA_MODEL_ID = "com.tinyclaw.EXTRA_MODEL_ID"
        const val EXTRA_AGENT_ID = "com.tinyclaw.EXTRA_AGENT_ID"
        const val EXTRA_TEAM_ID = "com.tinyclaw.EXTRA_TEAM_ID"
        const val ACTION_STATUS_CHANGED = "com.tinyclaw.STATUS_CHANGED"
        const val EXTRA_STATUS = "status"
        const val EXTRA_ERROR = "error"

        init {
            System.loadLibrary("tinyclaw_android")
        }
    }

    private external fun nativeStart(dataDir: String, modelId: String): Int
    private external fun nativeStop(): Int

    private var currentModel: String = "gemma3-1b"
    private var currentAgent: String = ""
    private var currentTeam: String = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Log.i(TAG, "Stop requested")
            nativeStop()
            broadcastStatus("stopped")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        currentModel = intent?.getStringExtra(EXTRA_MODEL_ID) ?: "gemma3-1b"
        currentAgent = intent?.getStringExtra(EXTRA_AGENT_ID) ?: ""
        currentTeam = intent?.getStringExtra(EXTRA_TEAM_ID) ?: ""

        Log.i(TAG, "Starting with model: $currentModel, agent: $currentAgent, team: $currentTeam")

        startForeground(1, buildNotification())
        broadcastStatus("starting")

        val result = nativeStart(filesDir.absolutePath, currentModel)
        if (result != 0) {
            Log.e(TAG, "nativeStart returned error code: $result")
            broadcastStatus("error", "Native start failed with code $result")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        broadcastStatus("running")
        return START_STICKY
    }

    override fun onDestroy() {
        Log.i(TAG, "Service destroyed")
        nativeStop()
        broadcastStatus("stopped")
        super.onDestroy()
    }

    private fun broadcastStatus(status: String, error: String? = null) {
        val intent = Intent(ACTION_STATUS_CHANGED).apply {
            putExtra(EXTRA_STATUS, status)
            if (error != null) putExtra(EXTRA_ERROR, error)
        }
        LocalBroadcastManager.getInstance(this).sendBroadcast(intent)
    }

    private fun buildNotification(): Notification {
        val stopIntent = Intent(this, TinyClawService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPending = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val openIntent = Intent(this, MainActivity::class.java)
        val openPending = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val subtitle = buildString {
            append(currentModel)
            if (currentAgent.isNotEmpty()) append(" \u2022 @$currentAgent")
            if (currentTeam.isNotEmpty()) append(" \u2022 #$currentTeam")
            append(" \u2022 localhost:8787")
        }

        return NotificationCompat.Builder(this, TinyClawApp.CHANNEL_ID)
            .setContentTitle("TinyClaw")
            .setContentText(subtitle)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(openPending)
            .addAction(0, "Stop", stopPending)
            .setOngoing(true)
            .build()
    }
}
