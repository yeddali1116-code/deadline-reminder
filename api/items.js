export default async function handler(req, res) {
  const NOTION_KEY = process.env.NOTION_API_KEY;
  const DB_ID = process.env.NOTION_DATABASE_ID;

  if (!NOTION_KEY || !DB_ID) {
    return res.status(500).json({ error: 'Missing Notion config' });
  }

  const headers = {
    'Authorization': 'Bearer ' + NOTION_KEY,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  const method = req.method;
  const itemId = req.query.id;

  try {
    // GET /api/items — 获取所有事项
    if (method === 'GET') {
      const data = await queryAll(DB_ID, headers);
      const items = data.map(parsePage);
      return res.json(items);
    }

    // POST /api/items — 添加事项
    if (method === 'POST') {
      const { name, deadline, address } = req.body;
      if (!name || !deadline) {
        return res.status(400).json({ error: '缺少必填字段' });
      }
      const props = {
        '名称': { title: [{ text: { content: name } }] },
        '截止日期': { date: { start: deadline } },
        '已完成': { checkbox: false }
      };
      if (address) {
        props['地址'] = { rich_text: [{ text: { content: address } }] };
      }
      const resp = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST', headers,
        body: JSON.stringify({ parent: { database_id: DB_ID }, properties: props })
      });
      const page = await resp.json();
      if (!resp.ok) {
        console.error('[Notion] POST pages 失败, 状态码:', resp.status, JSON.stringify(page));
        throw new Error('Notion API error (HTTP ' + resp.status + ')');
      }
      return res.json(parsePage(page));
    }

    // PATCH /api/items?id=xxx — 更新事项
    if (method === 'PATCH' && itemId) {
      const updates = req.body;
      const props = {};
      if (updates.name !== undefined) {
        props['名称'] = { title: [{ text: { content: updates.name } }] };
      }
      if (updates.deadline !== undefined) {
        props['截止日期'] = { date: { start: updates.deadline } };
      }
      if (updates.address !== undefined) {
        props['地址'] = { rich_text: [{ text: { content: updates.address } }] };
      }
      if (updates.completed !== undefined) {
        props['已完成'] = { checkbox: updates.completed };
      }
      const resp = await fetch('https://api.notion.com/v1/pages/' + itemId, {
        method: 'PATCH', headers,
        body: JSON.stringify({ properties: props })
      });
      const page = await resp.json();
      if (!resp.ok) {
        console.error('[Notion] PATCH page 失败, 状态码:', resp.status, JSON.stringify(page));
        throw new Error('Notion API error (HTTP ' + resp.status + ')');
      }
      return res.json(parsePage(page));
    }

    // DELETE /api/items?id=xxx — 归档事项
    if (method === 'DELETE' && itemId) {
      const resp = await fetch('https://api.notion.com/v1/pages/' + itemId, {
        method: 'PATCH', headers,
        body: JSON.stringify({ archived: true })
      });
      if (!resp.ok) {
        const err = await resp.json();
        console.error('[Notion] DELETE (archive) 失败, 状态码:', resp.status, JSON.stringify(err));
        throw new Error('Notion API error (HTTP ' + resp.status + ')');
      }
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}

async function queryAll(dbId, headers) {
  let results = [];
  let cursor;
  do {
    const resp = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'POST', headers,
      body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 })
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error('[Notion] query 失败, 状态码:', resp.status, JSON.stringify(data));
      throw new Error('Notion API error (HTTP ' + resp.status + ')');
    }
    results = results.concat(data.results);
    cursor = data.next_cursor;
  } while (cursor);
  return results;
}

function parsePage(page) {
  const props = page.properties || {};
  const name = getTitle(props['名称']);
  const deadline = getDate(props['截止日期']);
  const address = getRichText(props['地址']);
  const completed = getCheckbox(props['已完成']);
  return {
    id: page.id,
    name,
    deadline,
    address,
    completed,
    createdAt: page.created_time
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
