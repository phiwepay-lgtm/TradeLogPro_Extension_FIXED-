chrome.tabs.query({active:true,currentWindow:true}, ([tab])=>{
  const msg=document.getElementById('message'), status=document.getElementById('status');
  const isExness=/^https:\/\/(?:[^/]+\.)?exness\.com\//i.test(tab?.url || '');
  if(isExness){
    msg.textContent='Screenshot permission is enabled for this Exness tab.';
    msg.className='ok';
    status.textContent='Close this popup, open the Long Position or Short Position tool, then double-click it. Access is temporary for this tab and is removed when you navigate away.';
  }else{
    msg.textContent='Open your Exness trading terminal first.';
    msg.className='warn';
    status.textContent='Clicking the extension icon grants temporary screenshot access only to the active tab; this extension does not request access to every website.';
  }
});