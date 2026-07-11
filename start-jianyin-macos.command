#!/bin/zsh

set -e
PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR"

node_supported() {
  command -v node >/dev/null 2>&1 || return 1
  command -v npm >/dev/null 2>&1 || return 1
  node -e 'const [M,m]=process.versions.node.split(".").map(Number);process.exit((M===20&&m>=19)||(M===22&&m>=12)||M>22?0:1)' >/dev/null 2>&1
}

if ! node_supported; then
  RUNTIME_DIR="$PROJECT_DIR/.runtime/node"
  if [[ ! -x "$RUNTIME_DIR/bin/node" ]]; then
    echo "未检测到兼容的 Node.js，正在下载官方 Node 22 LTS 到项目目录..."
    case "$(uname -m)" in
      arm64) NODE_ARCH="arm64" ;;
      x86_64) NODE_ARCH="x64" ;;
      *) echo "不支持的 macOS 架构：$(uname -m)"; exit 1 ;;
    esac
    NODE_VERSION="$(curl -fsSL https://nodejs.org/dist/index.tab | awk -F '\t' '$1 ~ /^v22\./ && $10 != "-" && !found { version=$1; found=1 } END { print version }')"
    [[ -n "$NODE_VERSION" ]] || { echo "无法从 Node.js 官方索引找到 Node 22 LTS"; exit 1; }
    ARCHIVE_NAME="node-$NODE_VERSION-darwin-$NODE_ARCH.tar.gz"
    TEMP_DIR="$(mktemp -d -t jianyin-node)"
    trap 'rm -rf "$TEMP_DIR"' EXIT
    curl -fL "https://nodejs.org/dist/$NODE_VERSION/$ARCHIVE_NAME" -o "$TEMP_DIR/$ARCHIVE_NAME"
    curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$TEMP_DIR/SHASUMS256.txt"
    EXPECTED="$(awk -v name="$ARCHIVE_NAME" '$2 == name { print $1 }' "$TEMP_DIR/SHASUMS256.txt")"
    ACTUAL="$(shasum -a 256 "$TEMP_DIR/$ARCHIVE_NAME" | awk '{ print $1 }')"
    [[ -n "$EXPECTED" && "$ACTUAL" == "$EXPECTED" ]] || { echo "Node.js 下载文件 SHA-256 校验失败"; exit 1; }
    mkdir -p "$PROJECT_DIR/.runtime"
    mkdir -p "$TEMP_DIR/extracted"
    tar -xzf "$TEMP_DIR/$ARCHIVE_NAME" --strip-components=1 -C "$TEMP_DIR/extracted"
    [[ ! -e "$RUNTIME_DIR" ]] || rm -rf "$RUNTIME_DIR"
    mv "$TEMP_DIR/extracted" "$RUNTIME_DIR"
    echo "Node.js $NODE_VERSION 已准备完成。"
  fi
  export PATH="$RUNTIME_DIR/bin:$PATH"
fi

if ! node scripts/start-desktop.mjs; then
  echo
  read "?启动失败。按回车键关闭窗口。"
  exit 1
fi
