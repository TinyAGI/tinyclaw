use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Discord,
    Telegram,
    Whatsapp,
    Heartbeat,
    Http,
    Manual,
    Android,
}

impl Channel {
    pub fn as_str(&self) -> &str {
        match self {
            Channel::Discord => "discord",
            Channel::Telegram => "telegram",
            Channel::Whatsapp => "whatsapp",
            Channel::Heartbeat => "heartbeat",
            Channel::Http => "http",
            Channel::Manual => "manual",
            Channel::Android => "android",
        }
    }
}

impl fmt::Display for Channel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Incoming message — matches the upstream TypeScript `MessageData` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingMessage {
    pub channel: Channel,
    pub sender: String,
    pub sender_id: String,
    pub message: String,
    pub timestamp: u64,
    pub message_id: String,
    /// Optional pre-routed agent id (skips @agent_id parsing in queue processor).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    /// Optional file paths attached to this message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<String>>,
    /// Internal: conversation id for multi-agent team collaboration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    /// Internal: originating agent for agent-to-agent messages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_agent: Option<String>,
}

/// Outgoing response — matches the upstream TypeScript `ResponseData` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingMessage {
    pub channel: Channel,
    pub sender: String,
    pub message: String,
    pub original_message: String,
    pub timestamp: u64,
    pub message_id: String,
    /// Which agent handled this message (if routed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    /// Sender ID echoed from the incoming message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sender_id: Option<String>,
    /// File paths included in the response.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<String>>,
}

// ─── Agent / Team config types (mirrors upstream TypeScript) ─────────────

/// Per-agent configuration — matches upstream `AgentConfig`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub name: String,
    #[serde(default = "default_agent_provider")]
    pub provider: String,
    #[serde(default = "default_agent_model")]
    pub model: String,
    #[serde(default)]
    pub working_directory: String,
}

fn default_agent_provider() -> String {
    "anthropic".into()
}
fn default_agent_model() -> String {
    "sonnet".into()
}

/// Team configuration — matches upstream `TeamConfig`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamConfig {
    pub name: String,
    #[serde(default)]
    pub agents: Vec<String>,
    #[serde(default)]
    pub leader_agent: String,
}
