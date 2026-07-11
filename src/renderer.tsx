import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>村田鉄筋㈱ 加工数量分析システム</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/dayjs.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.0/dist/jspdf.plugin.autotable.min.js"></script>
        <link href="/static/style.css" rel="stylesheet" />
      </head>
      <body class="bg-gray-100 min-h-screen">
        {/* サンドボックス環境バナー: 本番ドメイン(pages.dev)以外で表示 */}
        <div id="sandbox-banner" style="display:none" class="bg-yellow-400 text-yellow-900 border-b-2 border-yellow-600 py-2 px-4 text-center text-sm font-semibold shadow-md sticky top-0 z-50">
          <i class="fas fa-flask mr-2"></i>
          <span class="font-bold">サンドボックス環境</span>
          <span class="mx-2">/</span>
          <span>本番環境からコピーした検証用データです（編集しても本番には反映されません）</span>
        </div>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            try {
              var h = location.hostname;
              // 本番( murata-tekkin-processing.pages.dev )以外はサンドボックス扱い
              var isProd = /murata-tekkin-processing\\.pages\\.dev$/i.test(h);
              if (!isProd) {
                var el = document.getElementById('sandbox-banner');
                if (el) el.style.display = '';
              }
            } catch(e) {}
          })();
        ` }}></script>
        {children}
        <script src="/static/app.js"></script>
      </body>
    </html>
  )
})
