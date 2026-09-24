FROM debian:bookworm

# gcc is the NATIVE compiler and is not redundant with the cross one below.
# Cargo builds a dependency's build.rs for the BUILD HOST, and links it with
# the host triple's linker — plain `cc`. On an arm64 builder that triple is
# aarch64-unknown-linux-gnu, which .cargo/config.toml already points at the
# cross gcc, so the omission was invisible; on x86_64 it falls through to `cc`
# and the build dies compiling libm's build script. Anything that only breaks
# on a builder of the other architecture is worth naming.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libc6-dev \
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
