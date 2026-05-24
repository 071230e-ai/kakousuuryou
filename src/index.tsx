import { Hono } from 'hono'
import { renderer } from './renderer'
import api from './api'
import type { Bindings } from './types'

const app = new Hono<{ Bindings: Bindings }>()

app.use(renderer)

// API ルート
app.route('/api', api)

// メインアプリ画面 (SPA)
app.get('/', (c) => {
  return c.render(
    <div id="app">
      <div id="loading" class="flex items-center justify-center min-h-screen">
        <div class="text-center">
          <i class="fas fa-spinner fa-spin text-4xl text-blue-600"></i>
          <p class="mt-2 text-gray-600">読み込み中...</p>
        </div>
      </div>
    </div>
  )
})

// クライアント側JS本体は /static/app.js
app.get('/script.js', (c) => {
  return c.redirect('/static/app.js')
})

export default app
