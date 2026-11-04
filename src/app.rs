#[path = "pdf.rs"]
mod pdf;
#[path = "routes.rs"]
mod routes;
#[path = "views.rs"]
mod views;

use axum::{
    Router,
    routing::{get, post},
};

pub async fn run() {
    let app = Router::new()
        .route("/", get(views::index))
        .route("/style.css", get(routes::stylesheet))
        .route("/app.js", get(routes::app_script))
        .route("/model.js", get(routes::model_script))
        .route("/api/export/pdf", post(pdf::download_pdf));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000")
        .await
        .expect("failed to bind to 127.0.0.1:3000");
    eprintln!(
        "ER Model Builder is available at http://{}",
        listener
            .local_addr()
            .expect("listener address is available")
    );
    axum::serve(listener, app).await.expect("server failed");
}
