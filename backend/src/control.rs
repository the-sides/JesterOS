use std::{collections::HashMap, sync::{Arc, Mutex}};
use axum::{extract::{State, WebSocketUpgrade, ws::{Message, WebSocket}}, response::Response};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use uuid::Uuid;

#[derive(Clone, Default)]
pub struct Hub(Arc<Mutex<HashMap<String, Room>>>);
struct Room { screen: mpsc::Sender<Value>, operator: Option<(String, mpsc::Sender<Value>)> }
pub async fn connect(State(hub): State<Hub>, ws: WebSocketUpgrade) -> Response {
    ws.max_message_size(256 * 1024).on_upgrade(move |socket| serve(socket, hub))
}
async fn serve(mut socket: WebSocket, hub: Hub) {
    let (tx, mut rx) = mpsc::channel::<Value>(32);
    let id = Uuid::new_v4().to_string();
    let mut membership: Option<(String, bool)> = None;
    loop {
        tokio::select! {
            outgoing = rx.recv() => {
                let Some(value) = outgoing else { break };
                if socket.send(Message::Text(value.to_string().into())).await.is_err() { break; }
            }
            incoming = socket.recv() => {
                let Some(Ok(Message::Text(raw))) = incoming else { break };
                let Ok(value) = serde_json::from_str::<Value>(&raw) else { break };
                let kind = value["type"].as_str().unwrap_or("");
                if membership.is_none() {
                    if kind == "register" {
                        let code = Uuid::new_v4().simple().to_string()[..10].to_uppercase();
                        hub.0.lock().unwrap().insert(code.clone(), Room { screen: tx.clone(), operator: None });
                        membership = Some((code.clone(), true));
                        let _ = tx.try_send(json!({"type":"registered","code":code}));
                    } else if kind == "pair" {
                        let code = value["code"].as_str().unwrap_or("").trim().to_uppercase();
                        let mut rooms = hub.0.lock().unwrap();
                        if let Some(room) = rooms.get_mut(&code).filter(|r| r.operator.is_none()) {
                            room.operator = Some((id.clone(), tx.clone()));
                            membership = Some((code, false));
                            let _ = tx.try_send(json!({"type":"paired"}));
                            let _ = room.screen.try_send(json!({"type":"paired"}));
                        } else { let _ = tx.try_send(json!({"type":"error","message":"Pairing code unavailable or already in use."})); }
                    }
                } else if let Some((code, screen)) = &membership {
                    let rooms = hub.0.lock().unwrap();
                    if let Some(room) = rooms.get(code) {
                        let recipient = if *screen && ["state", "result"].contains(&kind) {
                            room.operator.as_ref().map(|(_, sender)| sender)
                        } else if !*screen && kind == "cue" { Some(&room.screen) } else { None };
                        if let Some(sender) = recipient {
                            if sender.try_send(value).is_err() { break; }
                        }
                    } else { break; }
                }
            }
        }
    }
    if let Some((code, screen)) = membership {
        let mut rooms = hub.0.lock().unwrap();
        if screen {
            if let Some(room) = rooms.remove(&code) { if let Some((_, sender)) = room.operator { let _ = sender.try_send(json!({"type":"disconnected"})); } }
        } else if let Some(room) = rooms.get_mut(&code) {
            if room.operator.as_ref().is_some_and(|(owner, _)| owner == &id) {
                room.operator = None;
                let _ = room.screen.try_send(json!({"type":"disconnected"}));
            }
        }
    }
}
