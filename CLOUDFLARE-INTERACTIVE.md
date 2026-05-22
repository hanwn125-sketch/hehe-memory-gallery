# Cloudflare 互动版部署

当前先部署不需要 R2 的互动版：

- 照片留言：存在 D1 数据库，你和她都能看到。
- 她上传的新合集：暂时保存在当前浏览器本地，不同步线上。

## 需要创建的 Cloudflare 资源

1. Cloudflare Pages 项目连接这个 GitHub 仓库。
2. D1 数据库：建议命名 `hehe_memory_gallery`。
3. Pages 环境变量：`ACCESS_PASSWORD`，填和网站访问密码相同的值。
4. Pages 绑定：
   - D1 binding name: `DB`

## Pages 构建设置

- Build command: `npm run build`
- Build output directory: `out`
- Root directory: 留空或 `/`

## 初始化数据库

创建 D1 后，在 Cloudflare 控制台的 D1 SQL 页面执行：

```sql
CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notes (
  item_id TEXT PRIMARY KEY,
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

配置完成后重新部署 Pages，网页里的留言会自动从本地模式切到线上同步模式。以后如果能启用 R2，再把上传同步打开。
