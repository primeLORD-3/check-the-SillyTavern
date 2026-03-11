# check-the-SillyTavern
酒馆聊天记录查看器,将聊天记录像酒馆的正则一样处理,仅呈现正文.目前在肘渲染和修bug
temux用这个命令启动
cd ~/sillytavern-chat-viewer-完整包
node scripts/serve-dist.mjs
然后在浏览器打开http://127.0.0.1:4173
需要有nodejs
包里要保留 dist 和 scripts/serve-dist.mjs
node这样安装
pkg update
pkg install nodejs
大更新:增加了渲染状态栏功能(需要导入角色卡)翻页查看功能
