import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
const port = 19000 + Math.floor(Math.random() * 10000);
const apiRoot = `http://127.0.0.1:${port}`;
const backend = spawn(process.env.PYTHON || "python", [fileURLToPath(new URL("../tests/fixtures/api_server.py", import.meta.url)), String(port)], {stdio:["ignore","pipe","pipe"]});
let backendLog = "";
backend.stdout.on("data", data => {backendLog += data;});
backend.stderr.on("data", data => {backendLog += data;});
backend.on("error", error => {backendLog += error.message;});
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1:5173/'});
for(const key of ['window','document','sessionStorage','localStorage','location','Event','MouseEvent'])globalThis[key]=dom.window[key];
globalThis.dispatchEvent=window.dispatchEvent.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
window.HTMLElement.prototype.scrollIntoView=()=>{};
const server=await createServer({server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const nativeFetch=globalThis.fetch;globalThis.fetch=(url,options)=>{url=new URL(url);url.port=String(port);return nativeFetch(url,options);};
for(let i=0;i<600;i++){try{await nativeFetch(apiRoot + '/api/v1/catalog/games/');break;}catch{await sleep(100);}}
let root;
try{
 const login=await fetch(apiRoot + '/api/v1/auth/login/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'alice',password:'Test-strong-pass-42'})});
 const tokens=await login.json();if(!tokens.access)throw Error(JSON.stringify(tokens) + backendLog);sessionStorage.setItem('gd-api-session',JSON.stringify(tokens));
 const {default:App}=await server.ssrLoadModule('/src/App.jsx');
 const auth={Authorization:`Bearer ${tokens.access}`};
 const bob=(await (await fetch(apiRoot + '/api/v1/auth/users/?search=bob',{headers:auth})).json()).results[0].id;
 for(const route of ['/','/game/orbital','/profile','/library','/cart','/checkout','/orders','/friends','/messages/'+bob,'/settings','/compare','/discover']){
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(MemoryRouter,{initialEntries:[route]},React.createElement(App))));
  for(let i=0;i<6;i++)await act(async()=>sleep(100));
  const text=document.body.textContent;
  if(!text.includes('GD'))throw Error('Blank page: '+route);
  if(text.includes('Сервер недоступен'))throw Error('Network failure: '+route);
  console.log('RENDER OK',route,text.length);
  if(route==='/game/orbital') {
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='В корзину');
    await act(async()=>button.click());for(let i=0;i<5;i++)await act(async()=>sleep(100));
    const cart=await (await fetch(apiRoot + '/api/v1/store/cart/',{headers:auth})).json();
    if(cart.results.length!==1)throw Error('Cart mutation not persisted');console.log('ACTION OK add to cart');
  }
  if(route==='/checkout') {
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Создать заказ');
    if(!button || button.disabled)throw Error('Checkout unavailable');
    await act(async()=>button.click());for(let i=0;i<5;i++)await act(async()=>sleep(100));
    if(!document.body.textContent.includes('Заказ создан'))throw Error('Order not created: '+document.body.textContent);
    const orders=await(await fetch(apiRoot + '/api/v1/store/orders/',{headers:auth})).json();
    if(orders.results[0].status!=='pending')throw Error('Frontend faked payment');console.log('ACTION OK server order pending');
  }
  if(route.startsWith('/messages/')) {
    const input=document.querySelector('input[aria-label="Сообщение другу"]');
    const {Simulate}=await import('react-dom/test-utils');
    await act(async()=>Simulate.change(input,{target:{value:'Hello from real API UI'}}));
    await act(async()=>document.querySelector('.message-form button').click());for(let i=0;i<5;i++)await act(async()=>sleep(100));
    const bobTokens=await(await fetch(apiRoot + '/api/v1/auth/login/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'bob',password:'Test-strong-pass-42'})})).json();
    const bobHeaders={Authorization:`Bearer ${bobTokens.access}`};
    const dialogs=await(await fetch(apiRoot + '/api/v1/chat/conversations/',{headers:bobHeaders})).json();
    const messages=await(await fetch(`${apiRoot}/api/v1/chat/conversations/${dialogs.results[0].id}/messages/`,{headers:bobHeaders})).json();
    if(messages.results[0]?.text!=='Hello from real API UI')throw Error('Message not received by Bob');console.log('ACTION OK message received by second account');
  }
  await act(async()=>root.unmount());root=null;
 }
}finally{if(root)await act(async()=>root.unmount());await server.close();dom.window.close();backend.kill();}
