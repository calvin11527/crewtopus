# SuperGrok → Crewtopus sync (bookmarklet)

SuperGrok **does not expose a public live usage API**. This helper scrapes the **text** of the SuperGrok usage UI in your browser and opens Crewtopus with the values filled in.

## One-time setup

1. Run Crewtopus (`npm run dev` → http://localhost:5173, or Docker → http://localhost:8080).
2. Drag this link to your bookmarks bar (create a bookmark manually if drag fails):

**Bookmark name:** `Sync SuperGrok → Crewtopus`

**Bookmark URL:** (copy everything below as one line)

```
javascript:(function(){try{var t=(document.body&&document.body.innerText)||'';var getNear=function(re){var m=t.match(re);if(!m)return null;var i=m.index||0;var s=t.slice(i,i+120);var p=s.match(/(\d{1,3}(?:\.\d+)?)\s*%/);return p?Number(p[1]):null};var percent=getNear(/SuperGrok|每週\s*SuperGrok|每周\s*SuperGrok/i);var build=getNear(/Grok\s*Build|\bBuild\b/i);var conversation=getNear(/對話|对话|Conversation/i);if(percent==null&&build!=null&&conversation!=null)percent=Math.round((build+conversation)*10)/10;if(percent==null){alert('Could not find SuperGrok % on this page. Open the SuperGrok usage/limit panel first.');return}var resetAt;var zh=t.match(/重設[於于]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(早上|上午|中午|下午|晚上)?\s*(\d{1,2}):(\d{2})/);if(zh){var y=+zh[1],mo=+zh[2],d=+zh[3],h=+zh[5],mi=+zh[6],per=zh[4]||'';if(per==='下午'||per==='晚上'){if(h<12)h+=12}if(per==='上午'||per==='早上'){if(h===12)h=0}if(per==='中午'&&h<12)h=12;resetAt=new Date(y,mo-1,d,h,mi,0,0).toISOString()}var payload={percent:percent,build:build,conversation:conversation,resetAt:resetAt,capturedAt:new Date().toISOString(),page:location.href};try{navigator.clipboard.writeText(JSON.stringify(payload,null,2))}catch(e){}var base=localStorage.getItem('crewtopusUrl')||'http://localhost:5173';var u=new URL('/agents',base.endsWith('/')?base:base+'/');u.searchParams.set('supergrok','1');u.searchParams.set('percent',String(percent));if(build!=null)u.searchParams.set('build',String(build));if(conversation!=null)u.searchParams.set('conversation',String(conversation));if(resetAt)u.searchParams.set('reset',resetAt);window.open(u.toString(),'_blank')}catch(err){alert('SuperGrok sync failed: '+(err&&err.message?err.message:err))}})();
```

3. Optional: on any Crewtopus tab, set a custom base URL in the browser console:

```js
localStorage.setItem('crewtopusUrl', 'http://localhost:8080') // Docker demo
```

## How to use

1. Open [grok.com](https://grok.com) (or the SuperGrok usage panel that shows **每週 SuperGrok 限制** / weekly limit).
2. Click the bookmark **Sync SuperGrok → Crewtopus**.
3. Crewtopus **Agents** opens with query params; usage applies automatically (or paste the clipboard JSON into **Paste SuperGrok text**).

## Paste fallback

If the bookmarklet cannot open Crewtopus:

1. Select the SuperGrok usage text (or use the JSON copied by the bookmarklet).
2. In Crewtopus → **Dashboard** or **Agents** → **Sync SuperGrok** → paste into **Paste SuperGrok text** → **Parse & apply**.

## Honesty

- This reads **visible page text**, not a private billing API.
- If the SuperGrok UI layout changes, re-copy text or update the bookmarklet.
- Always re-run after you use more SuperGrok quota.
