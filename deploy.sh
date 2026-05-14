#!/bin/bash
# 企鹅求职岛 - 上传并部署到阿里云
# 本地执行: bash deploy.sh

SERVER="root@47.106.113.136"
APP_DIR="/opt/recruitment-dashboard"

echo "=== 企鹅求职岛 部署 ==="

# 1. 打包排除不需要的文件
echo "[1/4] 打包项目..."
tar -czf deploy.tar.gz \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  --exclude='deploy.tar.gz' \
  src/ package.json package-lock.json \
  next.config.mjs tsconfig.json \
  tailwind.config.ts postcss.config.mjs \
  ecosystem.config.js 2>/dev/null
echo "打包完成 ✓"

# 2. 上传到服务器
echo "[2/4] 上传到 $SERVER..."
scp deploy.tar.gz $SERVER:$APP_DIR/
echo "上传完成 ✓"

# 3. 服务器端解压安装启动
echo "[3/4] 服务器部署..."
ssh $SERVER << 'ENDSSH'
cd /opt/recruitment-dashboard

# 解压
tar -xzf deploy.tar.gz
rm deploy.tar.gz

# 安装依赖
npm install --production

# 构建
npx next build

# 创建日志目录
mkdir -p logs

# 启动或重启
pm2 describe recruit-dashboard > /dev/null 2>&1
if [ $? -eq 0 ]; then
  pm2 restart recruit-dashboard
else
  pm2 start ecosystem.config.js
fi

pm2 save
echo "部署完成 ✓"
ENDSSH

# 4. 清理本地打包文件
echo "[4/4] 清理本地..."
rm -f deploy.tar.gz

echo ""
echo "=== 部署完成 ==="
echo "访问地址: http://47.106.113.136:3001"
echo "查看状态: ssh $SERVER 'pm2 status'"
echo "查看日志: ssh $SERVER 'pm2 logs recruit-dashboard'"
