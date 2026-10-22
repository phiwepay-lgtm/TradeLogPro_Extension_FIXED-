(() => {
  const handled = new Set();
  const deliver = trade => {
    if(!trade?.externalId || handled.has(trade.externalId)) return;
    handled.add(trade.externalId);
    const requestId = `${trade.externalId}-${Date.now()}`;
    window.postMessage({source:'tradelog-exness-extension',type:'import-trade',requestId,trade}, '*');
    const timeout = setTimeout(()=>handled.delete(trade.externalId), 8000);
    const onResult = event => {
      const msg = event.data;
      if(event.source !== window || msg?.source !== 'tradelog-journal' || msg.type !== 'import-result' || msg.requestId !== requestId) return;
      clearTimeout(timeout); window.removeEventListener('message',onResult);
      if(msg.ok) chrome.runtime.sendMessage({type:'trade-imported'});
      else handled.delete(trade.externalId);
    };
    window.addEventListener('message',onResult);
  };

  chrome.runtime.onMessage.addListener(message => {
    if(message?.type === 'deliver-pending-trade'){
      chrome.runtime.sendMessage({type:'get-pending-trade'}, result=>deliver(result?.trade));
    }
  });
  chrome.runtime.sendMessage({type:'get-pending-trade'}, result=>deliver(result?.trade));
})();