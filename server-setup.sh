#!/bin/bash
# 企鹅求职岛 - 阿里云服务器一键部署脚本
# 在 Ubuntu 22.04 服务器上执行: bash server-setup.sh

set -e

echo "=== 企鹅求职岛 服务器部署 ==="

# 1. 安装 Node.js 20.x
echo "[1/5] 安装 Node.js 20.x..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node.js $(node -v) ✓"

# 2. 安装 PM2
echo "[2/5] 安装 PM2..."
sudo npm install -g pm2
echo "PM2 ✓"

# 3. 创建应用目录
echo "[3/5] 创建应用目录..."
sudo mkdir -p /opt/recruitment-dashboard
sudo chown -R $USER:$USER /opt/recruitment-dashboard

# 4. 配置防火墙 (可选，如果使用安全组则跳过)
echo "[4/5] 防火墙配置..."
if command -v ufw &> /dev/null; then
  sudo ufw allow 3001/tcp 2>/dev/null || true
fi
echo "端口 3001 ✓"

# 5. PM2 开机自启
echo "[5/5] 设置 PM2 开机自启..."
pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true

echo ""
echo "=== 服务器准备完成 ==="
echo "下一步: 上传项目文件到 /opt/recruitment-dashboard"
echo "  scp -r ./* root@47.106.113.136:/opt/recruitment-dashboard/"
echo ""
