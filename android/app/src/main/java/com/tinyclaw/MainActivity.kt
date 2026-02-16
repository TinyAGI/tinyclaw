package com.tinyclaw

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import org.json.JSONObject
import java.io.File

class MainActivity : AppCompatActivity() {

    private var serviceRunning = false

    private lateinit var statusText: TextView
    private lateinit var toggleButton: Button
    private lateinit var modelSpinner: Spinner
    private lateinit var agentSpinner: Spinner
    private lateinit var teamSpinner: Spinner
    private lateinit var portText: TextView
    private lateinit var logText: TextView
    private lateinit var logScroll: ScrollView

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* proceed regardless */ }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val status = intent?.getStringExtra(TinyClawService.EXTRA_STATUS) ?: return
            val error = intent.getStringExtra(TinyClawService.EXTRA_ERROR)

            appendLog("Status: $status" + if (error != null) " ($error)" else "")

            when (status) {
                "running" -> {
                    serviceRunning = true
                    updateUi()
                }
                "stopped", "error" -> {
                    serviceRunning = false
                    updateUi()
                }
                "starting" -> {
                    statusText.text = getString(R.string.status_starting)
                    toggleButton.isEnabled = false
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.status_text)
        toggleButton = findViewById(R.id.toggle_button)
        modelSpinner = findViewById(R.id.model_spinner)
        agentSpinner = findViewById(R.id.agent_spinner)
        teamSpinner = findViewById(R.id.team_spinner)
        portText = findViewById(R.id.port_text)
        logText = findViewById(R.id.log_text)
        logScroll = findViewById(R.id.log_scroll)

        val models = arrayOf(
            "gemma3-1b",
            "gemma-3n-e2b",
            "gemma-3n-e4b",
            "phi-4-mini",
            "qwen2.5-1.5b"
        )
        modelSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, models)

        loadAgentsAndTeams()

        portText.text = getString(R.string.port_label, 8787)

        toggleButton.setOnClickListener {
            if (serviceRunning) {
                stopTinyClaw()
            } else {
                startTinyClaw()
            }
        }

        requestNotificationPermissionIfNeeded()
        updateUi()
    }

    override fun onResume() {
        super.onResume()
        LocalBroadcastManager.getInstance(this).registerReceiver(
            statusReceiver,
            IntentFilter(TinyClawService.ACTION_STATUS_CHANGED)
        )
        loadAgentsAndTeams()
    }

    override fun onPause() {
        super.onPause()
        LocalBroadcastManager.getInstance(this).unregisterReceiver(statusReceiver)
    }

    /**
     * Load agent and team lists from settings.json on disk.
     * Falls back to a single "(none)" entry when there is no config yet.
     */
    private fun loadAgentsAndTeams() {
        val settingsFile = File(filesDir, ".tinyclaw/settings.json")
        val agentNames = mutableListOf(getString(R.string.none_selected))
        val teamNames = mutableListOf(getString(R.string.none_selected))

        if (settingsFile.exists()) {
            try {
                val json = JSONObject(settingsFile.readText())

                if (json.has("agents")) {
                    val agents = json.getJSONObject("agents")
                    for (key in agents.keys()) {
                        val agent = agents.getJSONObject(key)
                        val label = agent.optString("name", key)
                        agentNames.add("$key ($label)")
                    }
                }

                if (json.has("teams")) {
                    val teams = json.getJSONObject("teams")
                    for (key in teams.keys()) {
                        val team = teams.getJSONObject(key)
                        val label = team.optString("name", key)
                        teamNames.add("$key ($label)")
                    }
                }
            } catch (e: Exception) {
                appendLog("Failed to parse settings: ${e.message}")
            }
        }

        agentSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, agentNames)
        teamSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, teamNames)
    }

    private fun startTinyClaw() {
        val selectedModel = modelSpinner.selectedItem as String
        val selectedAgent = agentSpinner.selectedItem as String
        val selectedTeam = teamSpinner.selectedItem as String

        // Extract agent id from "id (Name)" format; pass empty string for "(none)"
        val agentId = if (selectedAgent == getString(R.string.none_selected)) "" else selectedAgent.substringBefore(" ")
        val teamId = if (selectedTeam == getString(R.string.none_selected)) "" else selectedTeam.substringBefore(" ")

        val logParts = mutableListOf("Starting with model: $selectedModel")
        if (agentId.isNotEmpty()) logParts.add("agent: $agentId")
        if (teamId.isNotEmpty()) logParts.add("team: $teamId")
        appendLog(logParts.joinToString(", "))

        val intent = Intent(this, TinyClawService::class.java).apply {
            putExtra(TinyClawService.EXTRA_MODEL_ID, selectedModel)
            putExtra(TinyClawService.EXTRA_AGENT_ID, agentId)
            putExtra(TinyClawService.EXTRA_TEAM_ID, teamId)
        }
        ContextCompat.startForegroundService(this, intent)
        setSpinnersEnabled(false)
    }

    private fun stopTinyClaw() {
        appendLog("Stopping...")
        val intent = Intent(this, TinyClawService::class.java).apply {
            action = TinyClawService.ACTION_STOP
        }
        startService(intent)
    }

    private fun updateUi() {
        if (serviceRunning) {
            statusText.text = getString(R.string.status_running)
            toggleButton.text = getString(R.string.stop)
            toggleButton.isEnabled = true
            setSpinnersEnabled(false)
        } else {
            statusText.text = getString(R.string.status_stopped)
            toggleButton.text = getString(R.string.start)
            toggleButton.isEnabled = true
            setSpinnersEnabled(true)
        }
    }

    private fun setSpinnersEnabled(enabled: Boolean) {
        modelSpinner.isEnabled = enabled
        agentSpinner.isEnabled = enabled
        teamSpinner.isEnabled = enabled
    }

    private fun appendLog(line: String) {
        val ts = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US)
            .format(java.util.Date())
        logText.append("[$ts] $line\n")
        logScroll.post { logScroll.fullScroll(ScrollView.FOCUS_DOWN) }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }
}
