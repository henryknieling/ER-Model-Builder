default: run

# Start the Axum web server at http://127.0.0.1:3000.
run:
    cargo run

watch:
    cargo watch -x run

# Check the Rust application.
check:
    cargo check

# Run Rust and model-format tests.
test:
    cargo test
    node --test tests/model.test.cjs
