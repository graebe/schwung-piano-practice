FROM debian:bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc-aarch64-linux-gnu \
    binutils-aarch64-linux-gnu \
    libc6-dev-arm64-cross \
    ca-certificates \
    curl \
    file \
    && rm -rf /var/lib/apt/lists/*

# Rust builds the DSP; the cross-gcc above is still here as its LINKER, so the
# Rust artifact resolves against exactly the sysroot the C one did and the two
# cannot disagree about libc.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --profile minimal \
        --default-toolchain stable --target aarch64-unknown-linux-gnu \
    && chmod -R a+w "$RUSTUP_HOME" "$CARGO_HOME"

WORKDIR /build
ENV CROSS_PREFIX=aarch64-linux-gnu-
# The container runs as the invoking uid, which has no home to write to.
ENV CARGO_TARGET_DIR=/tmp/cargo-target
