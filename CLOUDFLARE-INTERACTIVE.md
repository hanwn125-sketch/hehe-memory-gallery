# Cloudflare 互动版部署

这个版本让网页可以在线同步两件事：

- 照片留言：存在 D1 数据库。
- 她上传的新合集：图片存在 R2，合集信息存在 D1。

## 需要创建的 Cloudflare 资源

1. Cloudflare Pages 项目连接这个 GitHub 仓库。
2. D1 数据库：建议命名 `hehe_memory_gallery`。
3. R2 Bucket：建议命名 `hehe-memory-photos`。
4. Pages 环境变量：`ACCESS_PASSWORD`，填和网站访问密码相同的值。
5. Pages 绑定：
   - D1 binding name: `DB`
   - R2 binding name: `PHOTOS`

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

配置完成后重新部署 Pages，网页里的留言和上传会自动从本地模式切到线上同步模式。
