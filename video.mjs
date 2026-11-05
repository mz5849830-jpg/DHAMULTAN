// Video link parser (same code as in app.html). Used for sitemap, page tags and schema.
/* Video link -> {p:platform, embed, watch, thumb, tall, ...} or null. Same code runs in the browser (app.html) and on the server (lib/video.mjs). */
function vidParseCore(u,host){
  u=String(u||'').trim();if(!u)return null;
  var fr=/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(u);if(fr)u=fr[1].replace(/&amp;/g,'&');
  if(/^\/\//.test(u))u='https:'+u;
  function yt(id,t){return {p:'youtube',id:id,start:t||0,embed:'https://www.youtube-nocookie.com/embed/'+id+'?rel=0&modestbranding=1&playsinline=1'+(t?'&start='+t:''),watch:'https://www.youtube.com/watch?v='+id,thumb:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg'}}
  if(/^[\w-]{11}$/.test(u))return yt(u,0);
  var x;try{x=new URL(/^https?:\/\//i.test(u)?u:'https://'+u)}catch(e){return null}
  if(!/^https?:$/.test(x.protocol))return null;
  var h=x.hostname.toLowerCase().replace(/^(www|m|music|web|mobile)\./,''),p=x.pathname,q=x.searchParams,m;
  /* YouTube */
  if(h==='youtu.be'||/^youtube(-nocookie)?\.com$/.test(h)){
    var id='';
    if(h==='youtu.be')id=p.slice(1).split('/')[0];
    else if(p==='/watch')id=q.get('v')||'';
    else{m=/^\/(embed|shorts|live|v)\/([\w-]{11})/.exec(p);if(m)id=m[2]}
    if(!/^[\w-]{11}$/.test(id))return null;
    var tt=q.get('t')||q.get('start')||'',st=0,mm=/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(tt);
    if(mm&&tt)st=(+mm[1]||0)*3600+(+mm[2]||0)*60+(+mm[3]||0);
    return yt(id,st);
  }
  /* Facebook videos, reels and watch links (also the plugin/embed address from an embed code) */
  if(h==='facebook.com'||h==='fb.com'||h==='fb.watch'){
    var href=x.href;
    if(p==='/plugins/video.php'){
      href=q.get('href')||'';
      try{var fx=new URL(href);if(!/(^|\.)(facebook\.com|fb\.watch)$/.test(fx.hostname))return null}catch(e){return null}
    }else if(h!=='fb.watch'&&!(/\/videos?\//.test(p)||(/^\/watch\/?$/.test(p)&&q.get('v'))||/^\/reels?\//.test(p)||/^\/share\/[vr]\//.test(p)||(p==='/video.php'&&q.get('v'))))return null;
    return {p:'facebook',embed:'https://www.facebook.com/plugins/video.php?show_text=false&t=0&href='+encodeURIComponent(href),watch:href,thumb:'',tall:/\/reels?\//.test(href)};
  }
  /* Instagram posts, reels, IGTV */
  if(h==='instagram.com'||h==='instagr.am'){
    m=/^\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]+)/.exec(p);if(!m)return null;
    var k=m[1]==='reels'?'reel':m[1];
    return {p:'instagram',embed:'https://www.instagram.com/'+k+'/'+m[2]+'/embed/',watch:'https://www.instagram.com/'+k+'/'+m[2]+'/',thumb:'',tall:true};
  }
  /* TikTok (the full link with /video/<number>; short vm.tiktok.com links cannot be resolved) */
  if(h==='tiktok.com'){
    m=/\/video\/(\d{8,25})/.exec(p)||/^\/embed\/v2\/(\d{8,25})/.exec(p);if(!m)return null;
    return {p:'tiktok',embed:'https://www.tiktok.com/embed/v2/'+m[1],watch:/\/video\//.test(p)?'https://www.tiktok.com'+p:'https://www.tiktok.com/embed/v2/'+m[1],thumb:'',tall:true};
  }
  /* Vimeo */
  if(h==='vimeo.com'||h==='player.vimeo.com'){
    m=/^\/(?:video\/|(?:channels\/[\w-]+|groups\/[\w-]+\/videos|album\/\d+\/video)\/)?(\d{6,12})(?:\/([0-9a-f]{6,}))?\/?$/.exec(p);if(!m)return null;
    var hh=m[2]||q.get('h')||'';if(hh&&!/^[0-9a-f]{6,}$/.test(hh))hh='';
    return {p:'vimeo',embed:'https://player.vimeo.com/video/'+m[1]+'?dnt=1'+(hh?'&h='+hh:''),watch:'https://vimeo.com/'+m[1]+(hh?'/'+hh:''),thumb:''};
  }
  /* X / Twitter posts */
  if(h==='x.com'||h==='twitter.com'){
    m=/\/status(?:es)?\/(\d{5,25})/.exec(p);if(!m)return null;
    return {p:'x',embed:'https://platform.twitter.com/embed/Tweet.html?dnt=true&id='+m[1],watch:'https://x.com/i/status/'+m[1],thumb:'',tall:true};
  }
  /* Dailymotion */
  if(h==='dailymotion.com'||h==='dai.ly'){
    m=h==='dai.ly'?/^\/([a-z0-9]+)\/?$/i.exec(p):/^\/(?:embed\/)?video\/([a-z0-9]+)/i.exec(p);if(!m)return null;
    return {p:'dailymotion',embed:'https://www.dailymotion.com/embed/video/'+m[1],watch:'https://www.dailymotion.com/video/'+m[1],thumb:'https://www.dailymotion.com/thumbnail/video/'+m[1]};
  }
  /* Twitch videos and clips (Twitch needs the site's own address as "parent") */
  if(h==='twitch.tv'||h==='clips.twitch.tv'){
    var par='&parent='+encodeURIComponent(host||'localhost'),vm=h==='twitch.tv'?/^\/videos\/(\d{5,15})/.exec(p):null;
    if(vm)return {p:'twitch',embed:'https://player.twitch.tv/?autoplay=false&video=v'+vm[1]+par,watch:'https://www.twitch.tv/videos/'+vm[1],thumb:''};
    var cm=h==='clips.twitch.tv'?/^\/([\w-]{4,100})/.exec(p):/^\/\w+\/clip\/([\w-]{4,100})/.exec(p);
    if(cm)return {p:'twitch',embed:'https://clips.twitch.tv/embed?autoplay=false&clip='+cm[1]+par,watch:'https://clips.twitch.tv/'+cm[1],thumb:''};
    return null;
  }
  /* a video file on any https address */
  if(x.protocol==='https:'&&/\.(mp4|webm|ogv|mov|m4v)$/i.test(p))return {p:'file',file:true,src:x.href,watch:x.href,thumb:''};
  return null;
}

export const vidParse = (u) => vidParseCore(u, "");
