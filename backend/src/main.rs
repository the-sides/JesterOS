use std::{error::Error, net::SocketAddr, path::PathBuf};

use axum::{
    Json, Router,
    http::{StatusCode, header},
    routing::{any, get, get_service},
};
use clap::Parser;
use serde::Serialize;
use tower_http::services::ServeDir;

#[derive(Parser)]
#[command(
    name = "jesteros-backend",
    version,
    about = "Serve the JesterOS puppet desktop and health API",
    after_help = "From the repository root:\n  cargo run --manifest-path backend/Cargo.toml\n\nBuild the desktop first with `bun run build`.\nFor Vite development:\n  cargo run --manifest-path backend/Cargo.toml -- --api-only\n\nFor LAN access, add --bind 0.0.0.0:3000."
)]
struct Args {
    /// Address and port to listen on
    #[arg(long, default_value = "127.0.0.1:3000")]
    bind: SocketAddr,

    /// Built desktop directory (default: frontend/dist next to backend; ignored with --api-only)
    #[arg(long, value_name = "PATH")]
    frontend_dir: Option<PathBuf>,

    /// Serve only the API, without requiring a frontend build
    #[arg(long)]
    api_only: bool,
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    service: &'static str,
    version: &'static str,
}

#[derive(Serialize)]
struct ApiError {
    error: &'static str,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let args = Args::parse();
    let mut app = Router::new()
        .route("/api/health", get(health))
        .route("/api", any(not_found))
        .route("/api/", any(not_found))
        .route("/api/{*path}", any(not_found))
        .method_not_allowed_fallback(method_not_allowed);

    if args.api_only {
        app = app.fallback(not_found);
    } else {
        let frontend_dir = args.frontend_dir.unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("frontend")
                .join("dist")
        });
        let index = frontend_dir.join("index.html");
        if !index.is_file() {
            return Err(format!(
                "Frontend build missing: {}. Run `bun run build` from the repository root, \
                 choose a built directory with --frontend-dir PATH, or use --api-only for Vite development.",
                index.display()
            )
            .into());
        }
        println!("Serving desktop files from {}", frontend_dir.display());
        app = app.fallback_service(
            get_service(ServeDir::new(frontend_dir)).fallback(method_not_allowed),
        );
    }

    let listener = tokio::net::TcpListener::bind(args.bind).await?;
    println!(
        "JesterOS listening on http://{}{}",
        listener.local_addr()?,
        if args.api_only { " (API only)" } else { "" }
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn health() -> Json<Health> {
    Json(Health {
        status: "ok",
        service: "jesteros",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn not_found() -> (StatusCode, Json<ApiError>) {
    (StatusCode::NOT_FOUND, Json(ApiError { error: "Not found" }))
}

async fn method_not_allowed() -> (
    StatusCode,
    [(header::HeaderName, &'static str); 1],
    Json<ApiError>,
) {
    (
        StatusCode::METHOD_NOT_ALLOWED,
        [(header::ALLOW, "GET, HEAD")],
        Json(ApiError {
            error: "Method not allowed",
        }),
    )
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        eprintln!("Unable to listen for Ctrl-C: {error}");
    }
}
