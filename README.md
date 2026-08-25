# YarnTime PWA v1

這是一個可安裝到 iPhone 主畫面的網頁 App（PWA）。

## 已完成
- 多個毛線作品分開計時
- 一次只讓一件作品計時
- 開始 / 暫停
- 分段紀錄
- 每件作品累積工時
- 工時統計
- 本機資料保存
- JSON 備份 / 匯入
- iPhone 加到主畫面後可全螢幕使用
- 切到背景或鎖螢幕後，回來仍會依開始時間正確計算

## iPhone PWA 的限制
iOS 網頁 App 不能像原生 App 一樣真正長時間在背景執行，也不能使用 Dynamic Island 做即時控制。
YarnTime 使用「開始時間戳」計算，因此即使背景暫停執行 JavaScript，回到 App 後工時仍會正確。

## 怎麼放上網
最簡單是把整個資料夾部署到任何支援 HTTPS 的靜態網站服務，例如 GitHub Pages、Cloudflare Pages、Netlify、Vercel。

PWA 的 service worker 通常需要 HTTPS（localhost 例外）。

## iPhone 安裝
1. Safari 開啟部署後的網址。
2. 點 Safari 分享按鈕。
3. 選「加入主畫面」。
4. 名稱保留 YarnTime，按「加入」。
5. 回到主畫面，會看到 YarnTime 圖示。

## 本機測試
如果電腦有 Python：
```bash
python -m http.server 8000
```
然後在瀏覽器開啟 http://localhost:8000

同一 Wi‑Fi 下，也可以用電腦的區網 IP 讓 iPhone 暫時開啟測試，但完整 PWA 安裝與 service worker 建議使用 HTTPS。


## v2 更新
- 分段紀錄同時顯示「本段時間」與「累積時間」。
- 按下分段的瞬間即固定時間，輸入分段名稱的時間不會被算進上一段。
- 舊版分段資料可直接相容，不需刪除原有作品。
- 更新 service worker 快取策略，部署新版後較不容易卡在舊檔。
