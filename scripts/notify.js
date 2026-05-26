// 定时读取 Notion 数据库，检测即将到期的任务，通过 Server酱 发送微信提醒
// 由 GitHub Actions 定时调用

const NOTION_KEY = process.env.NOTION_API_KEY;
const DB_ID = process.env.NOTION_DATABASE_ID;
const SENDKEY = process.env.SENDKEY;

async function main() {
  console.log('[DDL Notify] 开始检测...');
  console.log('[DDL Notify] 时间:', new Date().toISOString());

  if (!NOTION_KEY) throw new Error('缺少环境变量 NOTION_API_KEY');
  if (!DB_ID) throw new Error('缺少环境变量 NOTION_DATABASE_ID');
  if (!SENDKEY) throw new Error('缺少环境变量 SENDKEY');

  // 1. 查询 Notion 数据库中所有未完成的事项
  const items = await queryNotion(DB_ID, NOTION_KEY);
  console.log('[DDL Notify] 从 Notion 读取到', items.length, '条未完成事项');

  // 2. 筛选距离 deadline 还有 1、3、5 天的事项
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const notifyItems = items.filter(item => {
    if (!item.deadline) return false;
    const dl = new Date(item.deadline + 'T00:00:00');
    const days = Math.ceil((dl - today) / (1000 * 60 * 60 * 24));
    return days === 1 || days === 3 || days === 5;
  });

  if (notifyItems.length === 0) {
    console.log('[DDL Notify] 今日无即将到期的任务');
    return;
  }

  console.log('[DDL Notify] 找到', notifyItems.length, '条需要提醒的任务:');
  notifyItems.forEach(i => {
    const days = getDaysUntil(i.deadline);
    console.log('  - [' + i.name + '] 还有' + days + '天截止');
  });

  // 3. 通过 Server酱 发送微信提醒
  const title = '⚠️ DDL提醒：' + notifyItems.length + '个任务即将截止';
  const lines = notifyItems.map(i => {
    const days = getDaysUntil(i.deadline);
    const addr = i.address ? '，地址：' + i.address : '';
    return '【' + i.name + '】还有' + days + '天截止' + addr;
  });
  const desp = lines.join('\n\n');

  await sendServerChan(SENDKEY, title, desp);
  console.log('[DDL Notify] 微信提醒已发送');
}

function getDaysUntil(deadline) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dl = new Date(deadline + 'T00:00:00');
  return Math.ceil((dl - today) / (1000 * 60 * 60 * 24));
}

async function queryNotion(dbId, apiKey) {
  const headers = {
    'Authorization': 'Bearer ' + apiKey,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  let results = [];
  let cursor;
  do {
    const body = {
      filter: { property: '已完成', checkbox: { equals: false } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {})
    };
    const resp = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error('[Notion] 请求失败, URL:', 'https://api.notion.com/v1/databases/' + dbId + '/query');
      console.error('[Notion] 状态码:', resp.status);
      console.error('[Notion] 响应:', JSON.stringify(data));
      if (resp.status === 403) {
        throw new Error(
          'Notion API 返回 403 Forbidden。请检查:\n' +
          '  1. NOTION_API_KEY 是否正确且未过期\n' +
          '  2. 在 Notion 页面中是否已将集成添加到数据库的 Connections 中\n' +
          '     (打开数据库 → 右上角 ... → Connections → 添加你的集成)'
        );
      }
      throw new Error('Notion query failed (HTTP ' + resp.status + '): ' + JSON.stringify(data));
    }
    results = results.concat(data.results);
    cursor = data.next_cursor;
  } while (cursor);

  return results.map(parsePage);
}

function parsePage(page) {
  const props = page.properties || {};
  return {
    name: getTitle(props['名称']),
    deadline: getDate(props['截止日期']),
    address: getRichText(props['地址']),
    completed: getCheckbox(props['已完成'])
  };
}

function getTitle(prop) {
  if (!prop || !prop.title) return '';
  return prop.title.map(t => t.plain_text || t.text?.content || '').join('');
}

function getDate(prop) {
  if (!prop || !prop.date || !prop.date.start) return '';
  return prop.date.start;
}

function getRichText(prop) {
  if (!prop || !prop.rich_text) return '';
  return prop.rich_text.map(t => t.plain_text || t.text?.content || '').join('');
}

function getCheckbox(prop) {
  if (!prop) return false;
  return !!prop.checkbox;
}

async function sendServerChan(sendkey, title, desp) {
  const url = 'https://sctapi.ftqq.com/' + sendkey + '.send';
  const body = new URLSearchParams({ title, desp });
  console.log('[Server酱] 发送通知...');
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const text = await resp.text();
  console.log('[Server酱] 响应:', resp.status, text);
  if (!resp.ok) throw new Error('Server酱请求失败: ' + resp.status + ' ' + text);
}

main().catch(e => {
  console.error('[DDL Notify] 执行失败:', e.message);
  process.exit(1);
});
