(function(){
  "use strict";

  var LOGO_FULL = "assets/img/logo-full.png";
  var LOGO_ICON = "assets/img/logo-icon.png";

  // ---------------- State ----------------
  var clients = {};          // clientId(string) -> data
  var projects = {};         // projectId(string) -> data (includes client_id)
  var projectPayments = {};  // projectId(string) -> [payments] (client -> you)
  var vendorPayments = {};   // projectId(string) -> [vendor payments] (you -> vendor)
  var cashEntries = [];      // General business income / expense entries
  var invoices = {};         // id(string) -> data
  var receipts = {};         // id(string) -> payment receipt
  var receiptsByPayment = {}; // paymentId(string) -> receiptId(string)
  var receiptsError = "";    // set when the receipts table isn't migrated yet
  var currentReceiptId = null;
  var settings = null;
  var currentClientId = null;
  var currentProjectId = null;
  var itemRowCount = 0;

  var BUSINESS_DEFAULT = {
    legalName: "NikhilWorks", tagline: "WEB DEVELOPMENT & SEO", ownerName: "Nikhil Gupta",
    gstin: "", pan: "", address: "", state: "Delhi",
    email: "", phone: "", website: "",
    bank: { accountName: "", accountNumber: "", ifsc: "", bankName: "", branch: "" },
    proformaValidityDays: 7,
    taxPrefix: "NW", taxCounter: 1, proformaPrefix: "PF", proformaCounter: 1,
    receiptPrefix: "RC", receiptCounter: 1
  };

  // ---------------- Utilities ----------------
  function $(sel, root){ return (root||document).querySelector(sel); }
  function $all(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function todayISO(){ return new Date().toISOString().slice(0,10); }
  function currentMonthISO(){ return todayISO().slice(0,7); }
  function fmtDate(iso){
    if(!iso) return "—";
    var d = new Date(iso+"T00:00:00");
    if(isNaN(d)) return iso;
    return d.toLocaleDateString("en-IN", {day:"2-digit", month:"short", year:"numeric"});
  }
  function fmtMonth(m){
    if(!m) return "—";
    var parts = m.split("-"); if(parts.length<2) return m;
    var d = new Date(Number(parts[0]), Number(parts[1])-1, 1);
    if(isNaN(d)) return m;
    return d.toLocaleDateString("en-IN", {month:"short", year:"numeric"});
  }
  function fmtMoney(n){
    n = Number(n)||0;
    return "₹" + n.toLocaleString("en-IN", {maximumFractionDigits:2, minimumFractionDigits: (n%1!==0)?2:0});
  }
  function fmtMoneyDoc(n){
    n = Number(n)||0;
    return "₹" + n.toLocaleString("en-IN", {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  function toast(msg){
    var t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._h); toast._h = setTimeout(function(){ t.classList.remove("show"); }, 2600);
  }
  var ONES = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  var TENS = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  function twoDigits(n){ if(n<20) return ONES[n]; return (TENS[Math.floor(n/10)] + (n%10? " "+ONES[n%10] : "")).trim(); }
  function threeDigits(n){
    var s = "";
    if(n>=100){ s += ONES[Math.floor(n/100)] + " Hundred "; n%=100; }
    s += twoDigits(n);
    return s.trim();
  }
  function numberToWordsIndian(num){
    num = Math.round(Number(num)||0);
    if(num===0) return "Zero";
    var crore = Math.floor(num/10000000); num%=10000000;
    var lakh = Math.floor(num/100000); num%=100000;
    var thousand = Math.floor(num/1000); num%=1000;
    var rest = num;
    var parts = [];
    if(crore) parts.push(threeDigits(crore) + " Crore");
    if(lakh) parts.push(threeDigits(lakh) + " Lakh");
    if(thousand) parts.push(threeDigits(thousand) + " Thousand");
    if(rest) parts.push(threeDigits(rest));
    return parts.join(" ").trim();
  }

  function projectsForClient(clientId){
    return Object.keys(projects).filter(function(pid){ return projects[pid].clientId===clientId; })
      .map(function(pid){ return Object.assign({id:pid}, projects[pid]); });
  }
  function calcProjectPaid(projectId){
    var list = projectPayments[projectId] || [];
    return list.reduce(function(sum,p){ return sum + (Number(p.amount)||0); }, 0);
  }
  function calcVendorPaid(projectId){
    var list = vendorPayments[projectId] || [];
    return list.reduce(function(sum,p){ return sum + (Number(p.amount)||0); }, 0);
  }
  function calcClientTotals(clientId){
    var list = projectsForClient(clientId);
    var total = 0, paid = 0;
    list.forEach(function(p){ total += Number(p.totalAmount)||0; paid += calcProjectPaid(p.id); });
    return { total: total, paid: paid, pending: total-paid, count: list.length };
  }
  function statusPill(status){
    var map = { active: ["pill-success","Active"], "on-hold": ["pill-warning","On hold"], completed: ["pill-muted","Completed"] };
    var m = map[status] || map.active;
    return '<span class="pill '+m[0]+'"><span class="pill-dot"></span>'+m[1]+'</span>';
  }
  function outsourcedTag(p){
    return p.isOutsourced ? '<span class="pill pill-warning"><span class="pill-dot"></span>Outsourced</span>' : '';
  }

  // ---------------- View routing ----------------
  function showView(name){
    $all(".view").forEach(function(v){ v.classList.toggle("active", v.getAttribute("data-view")===name); });
    $all("#navlist button, #bottomNav button[data-view]").forEach(function(b){ b.classList.toggle("active", b.getAttribute("data-view")===name); });
    // "More" lights up when the current page lives in the drawer
    var more = $("#menuBtn");
    if(more){ var inDrawer = !$('#bottomNav button[data-view="'+name+'"]') && !!$('#navlist button[data-view="'+name+'"]'); more.classList.toggle("active", inDrawer); }
    window.scrollTo(0,0);
  }
  function setDrawer(open){
    var d = $("#drawer"); if(!d) return;
    d.classList.toggle("open", open);
    var bd = $("#drawerBackdrop"); if(bd) bd.classList.toggle("open", open);
    var mb = $("#menuBtn"); if(mb) mb.setAttribute("aria-expanded", open ? "true" : "false");
    document.body.classList.toggle("drawer-open", open);
  }
  var NAV_VIEWS = ["dashboard","clients","projects","invoices","receipts","outsourcing","cashflow","letterhead","settings","profile"];
  function navTo(v, fromHash){
    setDrawer(false);
    if(!fromHash && location.hash.slice(1) !== v){ try{ history.pushState(null, "", "#"+v); }catch(e){} }
    showView(v);
    if(v==="letterhead") renderLetterhead();
    if(v==="settings") renderSettings();
    if(v==="profile") renderProfile();
    if(v==="outsourcing") renderOutsourcing();
    if(v==="cashflow") renderCashflow();
    if(v==="projects") renderProjectsList();
    if(v==="receipts") renderReceiptsTable();
  }
  $all("#navlist button, #bottomNav button[data-view]").forEach(function(b){
    b.addEventListener("click", function(){ navTo(b.getAttribute("data-view")); });
  });
  ["#menuBtn","#menuToggle"].forEach(function(sel){
    var el = $(sel); if(el) el.addEventListener("click", function(){ setDrawer(!$("#drawer").classList.contains("open")); });
  });
  ["#drawerBackdrop","#drawerClose"].forEach(function(sel){
    var el = $(sel); if(el) el.addEventListener("click", function(){ setDrawer(false); });
  });
  document.addEventListener("keydown", function(e){ if(e.key==="Escape") setDrawer(false); });
  // Back/forward and #links: each sidebar page has its own address (index.php#receipts)
  window.addEventListener("popstate", function(){
    var h = location.hash.slice(1);
    navTo(NAV_VIEWS.indexOf(h) >= 0 ? h : "dashboard", true);
  });


  // ---------------- Mobile: tables become stacked cards ----------------
  // CSS (max-width:760px) lays each row out as a card; it needs each cell to
  // know its column name, which we copy from the table header whenever the
  // body is (re)rendered.
  (function(){
    function label(table){
      var heads = Array.prototype.map.call(table.querySelectorAll("thead th"), function(th){ return th.textContent.trim(); });
      Array.prototype.forEach.call(table.querySelectorAll("tbody tr"), function(tr){
        if(tr.classList.contains("empty-row")) return;
        Array.prototype.forEach.call(tr.children, function(td, i){
          if(td.tagName==="TD" && heads[i] && td.getAttribute("data-label")!==heads[i]) td.setAttribute("data-label", heads[i]);
        });
      });
    }
    var queued = false;
    function labelAll(){ queued = false; $all(".table-wrap table").forEach(label); }
    labelAll();
    var main = $("main");
    if(main) new MutationObserver(function(){ if(!queued){ queued = true; requestAnimationFrame(labelAll); } })
      .observe(main, {childList:true, subtree:true});
  })();


  // ---------------- Global search ----------------
  (function(){
    var input = $("#globalSearch"), box = $("#searchResults");
    if(!input || !box) return;
    var PAGES = [
      ["dashboard","Dashboard","overview home stats"],["clients","Clients","customers"],["projects","Projects","services work"],
      ["invoices","Invoices","proforma tax pi"],["receipts","Receipts","payment received"],["outsourcing","Outsourcing","vendor"],
      ["cashflow","Cash Flow","income outgoing expenses accounting"],["letterhead","Letterhead","print"],["settings","Settings","business gstin numbering prefix"],
      ["profile","My Profile","account password biometric fingerprint face login user"]
    ];
    var active = -1, items = [];
    function norm(x){ return String(x==null?"":x).toLowerCase(); }
    function score(hay, words, first){
      hay = norm(hay);
      for(var i=0;i<words.length;i++) if(hay.indexOf(words[i])<0) return -1;
      var sc = 1;
      if(hay.indexOf(first)===0) sc += 3;
      else if(hay.indexOf(" "+first)>=0 || hay.indexOf("/"+first)>=0) sc += 1;
      return sc;
    }
    function build(q){
      var words = norm(q).trim().split(/\s+/).filter(Boolean), out = [];
      if(!words.length) return out;
      var first = words[0];
      PAGES.forEach(function(p){ var sc = score(p[1]+" "+p[2], words, first); if(sc>0) out.push({sc:sc+0.5, grp:"Pages", title:p[1], sub:"Open page", act:{page:p[0]}}); });
      Object.keys(clients).forEach(function(id){
        var c = clients[id], sc = score([c.name,c.contactName,c.phone,c.email,c.gstin].join(" "), words, first);
        if(sc>0) out.push({sc:sc+1, grp:"Clients", title:c.name, sub:[c.contactName,c.phone].filter(Boolean).join(" · "), act:{client:id}});
      });
      Object.keys(projects).forEach(function(id){
        var p = projects[id], cn = (clients[p.clientId]||{}).name||"", sc = score([p.title,cn,p.vendorName,p.status].join(" "), words, first);
        if(sc>0) out.push({sc:sc+1, grp:"Projects", title:p.title, sub:cn+(p.totalAmount? " · "+fmtMoney(p.totalAmount):""), act:{project:id}});
      });
      Object.keys(invoices).forEach(function(id){
        var v = invoices[id], sc = score([v.number,v.clientName,v.projectTitle,v.type].join(" "), words, first);
        if(sc>0) out.push({sc:sc, grp:"Invoices", title:v.number, sub:(v.type==="tax"?"Tax":"Proforma")+" · "+(v.clientName||"")+" · "+fmtMoney(v.total), act:{invoice:id}});
      });
      Object.keys(receipts).forEach(function(id){
        var r = receipts[id], sc = score([r.number,r.clientName,r.projectTitle,r.description,r.reference].join(" "), words, first);
        if(sc>0) out.push({sc:sc, grp:"Receipts", title:r.number, sub:(r.clientName||"")+" · "+fmtMoney(r.amount), act:{receipt:id}});
      });
      out.sort(function(a,b){ return b.sc-a.sc; });
      var counts = {}, res = [];
      out.forEach(function(o){ counts[o.grp]=(counts[o.grp]||0)+1; if(counts[o.grp]<=5) res.push(o); });
      var order = ["Pages","Clients","Projects","Invoices","Receipts"];
      res.sort(function(a,b){ return order.indexOf(a.grp)-order.indexOf(b.grp); });
      return res;
    }
    function close(){ box.classList.remove("open"); box.innerHTML=""; items=[]; active=-1; }
    function paint(){
      var q = input.value;
      if(!q.trim()){ close(); return; }
      items = build(q); active = items.length ? 0 : -1;
      if(!items.length){ box.innerHTML = '<div class="sr-empty">No matches for "'+esc(q)+'"</div>'; box.classList.add("open"); return; }
      var html = "", last = "";
      items.forEach(function(it, i){
        if(it.grp!==last){ html += '<div class="sr-group">'+it.grp+'</div>'; last = it.grp; }
        html += '<div class="sr-item'+(i===active?" active":"")+'" role="option" data-i="'+i+'"><div class="sr-title">'+esc(it.title)+'</div><div class="sr-sub">'+esc(it.sub||"")+'</div></div>';
      });
      box.innerHTML = html; box.classList.add("open");
    }
    function mark(){
      $all(".sr-item", box).forEach(function(el){ el.classList.toggle("active", Number(el.getAttribute("data-i"))===active); });
      var el = $(".sr-item.active", box); if(el && el.scrollIntoView) el.scrollIntoView({block:"nearest"});
    }
    function go(it){
      if(!it) return;
      input.value = ""; close(); input.blur();
      var a = it.act;
      if(a.page) navTo(a.page);
      else if(a.client) renderClientDetail(a.client);
      else if(a.project) renderProjectDetail(a.project);
      else if(a.invoice) renderInvoicePreview(a.invoice);
      else if(a.receipt) renderReceiptPreview(a.receipt);
    }
    input.addEventListener("input", paint);
    input.addEventListener("focus", paint);
    input.addEventListener("keydown", function(e){
      if(e.key==="ArrowDown" && items.length){ e.preventDefault(); active = (active+1)%items.length; mark(); }
      else if(e.key==="ArrowUp" && items.length){ e.preventDefault(); active = (active-1+items.length)%items.length; mark(); }
      else if(e.key==="Enter"){ e.preventDefault(); go(items[active]); }
      else if(e.key==="Escape"){ input.value=""; close(); input.blur(); }
    });
    box.addEventListener("mousedown", function(e){ e.preventDefault(); });   // keep focus so the click lands
    box.addEventListener("click", function(e){ var el = e.target.closest(".sr-item"); if(el) go(items[Number(el.getAttribute("data-i"))]); });
    document.addEventListener("click", function(e){ if(!e.target.closest("#searchbar")) close(); });
    // "/" or Ctrl/Cmd+K jumps to search from anywhere (unless typing in a field)
    document.addEventListener("keydown", function(e){
      var t = e.target, typing = t && (t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.tagName==="SELECT"||t.isContentEditable);
      if((e.key==="/" && !typing) || ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="k")){ e.preventDefault(); input.focus(); input.select(); }
    });
  })();

  // ---------------- Rendering: Dashboard ----------------
  function renderAll(){
    renderDashboard();
    renderClientsTable();
    renderInvoicesTable();
    renderReceiptsTable();
    if($('.view[data-view="projects"]').classList.contains("active")) renderProjectsList();
    if(currentProjectId && projects[currentProjectId]) renderProjectDetail(currentProjectId);
    else if(currentClientId && clients[currentClientId]) renderClientDetail(currentClientId);
    if($('.view[data-view="outsourcing"]').classList.contains("active")) renderOutsourcing();
    if($('.view[data-view="cashflow"]').classList.contains("active")) renderCashflow();
  }

  function renderDashboard(){
    var clientIds = Object.keys(clients);
    var projectIds = Object.keys(projects);
    var totalBilled = 0, totalPaid = 0;
    projectIds.forEach(function(pid){ totalBilled += Number(projects[pid].totalAmount)||0; totalPaid += calcProjectPaid(pid); });
    var totalPending = totalBilled - totalPaid;
    var activeProjects = projectIds.filter(function(pid){ return projects[pid].status!=="completed"; }).length;

    $("#todayLine").textContent = new Date().toLocaleDateString("en-IN",{weekday:"long", day:"numeric", month:"long", year:"numeric"});
    $("#statClients").textContent = clientIds.length;
    $("#statClientsSub").textContent = projectIds.length + " project(s) total, " + activeProjects + " active";
    $("#statBilled").textContent = fmtMoney(totalBilled);
    $("#statReceived").textContent = fmtMoney(totalPaid);
    $("#statReceivedSub").textContent = totalBilled? Math.round(totalPaid/totalBilled*100)+"% collected" : "—";
    $("#statPending").textContent = fmtMoney(totalPending);
    $("#statPendingSub").textContent = projectIds.filter(function(pid){ return (Number(projects[pid].totalAmount)||0) - calcProjectPaid(pid) > 0.5; }).length + " project(s) have pending payment";

    var pendRows = projectIds.map(function(pid){ return Object.assign({id:pid}, projects[pid]); })
      .filter(function(p){ return (Number(p.totalAmount)||0) - calcProjectPaid(p.id) > 0.5; })
      .sort(function(a,b){ return ((Number(b.totalAmount)||0)-calcProjectPaid(b.id)) - ((Number(a.totalAmount)||0)-calcProjectPaid(a.id)); })
      .slice(0,8);
    var body = $("#dashPendingBody");
    if(!pendRows.length){
      body.innerHTML = '<tr class="empty-row"><td colspan="7">Everyone\'s paid up. 🎉</td></tr>';
    } else {
      body.innerHTML = pendRows.map(function(p){
        var paid = calcProjectPaid(p.id), total = Number(p.totalAmount)||0, pending = total-paid;
        var pct = total? Math.min(100, Math.round(paid/total*100)) : 0;
        var client = clients[p.clientId];
        return '<tr class="clickable" data-open-project="'+p.id+'">'+
          '<td class="name-cell">'+esc(client?client.name:"—")+'</td>'+
          '<td class="muted">'+esc(p.title||"—")+'</td>'+
          '<td>'+statusPill(p.status)+'</td>'+
          '<td class="num">'+fmtMoney(total)+'</td>'+
          '<td class="num">'+fmtMoney(paid)+'</td>'+
          '<td class="num" style="color:var(--danger); font-weight:700;">'+fmtMoney(pending)+'</td>'+
          '<td><div class="bar"><span style="width:'+pct+'%"></span></div></td>'+
        '</tr>';
      }).join("");
    }

    var invList = Object.keys(invoices).map(function(id){ return Object.assign({id:id}, invoices[id]); })
      .sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); }).slice(0,6);
    var ibody = $("#dashInvoiceBody");
    ibody.innerHTML = invList.length ? invList.map(invoiceRowHTML).join("") : '<tr class="empty-row"><td colspan="6">No invoices generated yet.</td></tr>';
  }

  function invoiceRowHTML(inv){
    return '<tr class="clickable" data-open-invoice="'+inv.id+'">'+
      '<td class="num">'+esc(inv.number)+'</td>'+
      '<td class="name-cell">'+esc(inv.clientName)+'</td>'+
      '<td>'+(inv.type==="tax"?'<span class="pill pill-success"><span class="pill-dot"></span>Tax</span>':'<span class="pill pill-muted"><span class="pill-dot"></span>Proforma</span>')+'</td>'+
      '<td>'+fmtDate(inv.date)+'</td>'+
      '<td class="num">'+fmtMoney(inv.total)+'</td>'+
      '<td class="muted">View →</td>'+
    '</tr>';
  }

  // ---------------- Rendering: Clients ----------------
  function renderClientsTable(){
    var ids = Object.keys(clients).sort(function(a,b){ return (clients[b].createdAt||"").localeCompare(clients[a].createdAt||""); });
    var body = $("#clientsBody");
    if(!ids.length){ body.innerHTML = '<tr class="empty-row"><td colspan="5">No clients yet — click "New Client" to add your first one.</td></tr>'; return; }
    body.innerHTML = ids.map(function(id){
      var c = clients[id], t = calcClientTotals(id);
      return '<tr class="clickable" data-open-client="'+id+'">'+
        '<td class="name-cell">'+esc(c.name)+'</td>'+
        '<td class="num">'+t.count+'</td>'+
        '<td class="num">'+fmtMoney(t.total)+'</td>'+
        '<td class="num">'+fmtMoney(t.paid)+'</td>'+
        '<td class="num">'+fmtMoney(t.pending)+'</td>'+
      '</tr>';
    }).join("");
  }

  // ---------------- Rendering: All Projects (master list) ----------------
  function renderProjectsList(){
    var ids = Object.keys(projects).sort(function(a,b){ return (projects[b].createdAt||"").localeCompare(projects[a].createdAt||""); });
    var body = $("#projectsBody");
    if(!ids.length){ body.innerHTML = '<tr class="empty-row"><td colspan="8">No projects yet — open a client and click "New Project".</td></tr>'; return; }
    body.innerHTML = ids.map(function(id, idx){
      var p = projects[id], client = clients[p.clientId] || {};
      var paid = calcProjectPaid(id), total = Number(p.totalAmount)||0, pending = total-paid;
      return '<tr>'+
        '<td class="num muted">'+(idx+1)+'</td>'+
        '<td class="name-cell clickable" data-open-client="'+p.clientId+'">'+esc(client.name||"—")+'</td>'+
        '<td class="muted clickable" data-open-project="'+id+'">'+esc(p.title)+outsourcedTag(p)+'</td>'+
        '<td>'+statusPill(p.status)+'</td>'+
        '<td class="num">'+fmtMoney(total)+'</td>'+
        '<td class="num">'+fmtMoney(paid)+'</td>'+
        '<td class="num" style="color:'+(pending>0?"var(--danger)":"var(--success)")+'; font-weight:700;">'+fmtMoney(pending)+'</td>'+
        '<td><div class="row-actions">'+
          '<button class="btn btn-ghost btn-sm" data-action="record-payment" data-project-id="'+id+'">Payment</button>'+
          '<button class="btn btn-ghost btn-sm" data-action="invoice-for-project" data-client-id="'+p.clientId+'" data-project-id="'+id+'" data-invoice-type="proforma">PI</button>'+
          '<button class="btn btn-ghost btn-sm" data-action="invoice-for-project" data-client-id="'+p.clientId+'" data-project-id="'+id+'" data-invoice-type="tax">Tax</button>'+
        '</div></td>'+
      '</tr>';
    }).join("");
  }

  function renderClientDetail(id){
    var c = clients[id];
    if(!c){ showView("clients"); return; }
    currentClientId = id;
    currentProjectId = null;
    var t = calcClientTotals(id);
    var pct = t.total? Math.min(100, Math.round(t.paid/t.total*100)) : 0;
    var clientProjects = projectsForClient(id).sort(function(a,b){ return (b.createdAt||"").localeCompare(a.createdAt||""); });
    var clientInvoices = Object.keys(invoices).map(function(iid){ return Object.assign({id:iid}, invoices[iid]); })
      .filter(function(inv){ return inv.clientId===id; }).sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); });

    var projectCards = clientProjects.length ? clientProjects.map(function(p){
      var paid = calcProjectPaid(p.id), total = Number(p.totalAmount)||0, pending = total-paid;
      var ppct = total? Math.min(100, Math.round(paid/total*100)) : 0;
      var vendorLine = "";
      if(p.isOutsourced){
        var vPaid = calcVendorPaid(p.id), vTotal = Number(p.vendorCost)||0, vPending = vTotal-vPaid;
        vendorLine = '<div class="project-vendor-line">Outsourced to <b>'+esc(p.vendorName||"vendor")+'</b> · cost '+fmtMoney(vTotal)+' · paid '+fmtMoney(vPaid)+' · owed <b style="color:'+(vPending>0?"var(--danger)":"var(--success)")+'">'+fmtMoney(vPending)+'</b></div>';
      }
      return '<div class="card project-card clickable" data-open-project="'+p.id+'">'+
        '<div class="project-card-head">'+
          '<div><div class="project-title">'+esc(p.title)+'</div><div class="muted" style="font-size:12px;">Started '+fmtDate(p.startDate)+'</div></div>'+
          '<div style="display:flex; gap:6px; align-items:center;">'+outsourcedTag(p)+statusPill(p.status)+'</div>'+
        '</div>'+
        '<div class="project-card-stats">'+
          '<div><span class="muted">Total</span><b class="num">'+fmtMoney(total)+'</b></div>'+
          '<div><span class="muted">Paid</span><b class="num" style="color:var(--success)">'+fmtMoney(paid)+'</b></div>'+
          '<div><span class="muted">Pending</span><b class="num" style="color:'+(pending>0?"var(--danger)":"var(--success)")+'">'+fmtMoney(pending)+'</b></div>'+
        '</div>'+
        '<div class="bar" style="margin:8px 0;"><span style="width:'+ppct+'%"></span></div>'+
        vendorLine+
        '<div class="project-card-actions">'+
          '<button class="btn btn-ghost btn-sm" data-action="edit-project" data-id="'+p.id+'">Edit</button>'+
          '<button class="btn btn-primary btn-sm" data-action="record-payment" data-project-id="'+p.id+'">+ Payment</button>'+
          '<button class="btn btn-accent btn-sm" data-action="invoice-for-project" data-client-id="'+id+'" data-project-id="'+p.id+'">+ Invoice</button>'+
        '</div>'+
      '</div>';
    }).join("") : '<div class="empty-state" style="padding:34px 20px;"><h3>No projects yet</h3><p class="muted">Add this client\'s first project or service to start tracking cost &amp; payments.</p></div>';

    var html = ''+
      '<div class="detail-head">'+
        '<div><h1>'+esc(c.name)+'</h1><div class="sub" style="color:var(--muted); margin-top:4px;">'+t.count+' project(s) · '+esc(c.state||"—")+'</div></div>'+
        '<div style="display:flex; gap:10px; flex-wrap:wrap;">'+
          '<button class="btn btn-ghost btn-sm" data-action="cashflow-for" data-scope="c:'+id+'">Cash flow</button>'+
          '<button class="btn btn-ghost btn-sm" data-action="edit-client" data-id="'+id+'">Edit Client</button>'+
          '<button class="btn btn-primary btn-sm" data-action="new-project" data-client-id="'+id+'">+ New Project</button>'+
          '<button class="btn btn-accent btn-sm" data-action="invoice-for-client" data-id="'+id+'">+ Generate Invoice</button>'+
        '</div>'+
      '</div>'+
      '<div class="stat-row stat-row-3">'+
        '<div class="card stat"><div class="label">Total (all projects)</div><div class="value num">'+fmtMoney(t.total)+'</div></div>'+
        '<div class="card stat"><div class="label">Received</div><div class="value num" style="color:var(--success)">'+fmtMoney(t.paid)+'</div><div class="delta"><div class="bar" style="margin-top:4px;"><span style="width:'+pct+'%"></span></div></div></div>'+
        '<div class="card stat"><div class="label">Pending</div><div class="value num" style="color:'+(t.pending>0?"var(--danger)":"var(--success)")+'">'+fmtMoney(t.pending)+'</div></div>'+
      '</div>'+
      '<div class="detail-grid">'+
        '<div>'+
          '<div class="section-title">Projects &amp; services</div>'+
          '<div class="project-list">'+projectCards+'</div>'+
          '<div class="section-title">Invoices</div>'+
          '<div class="table-wrap">'+
            '<table><thead><tr><th>Number</th><th>Project</th><th>Type</th><th>Date</th><th class="num">Amount</th></tr></thead><tbody>'+
            (clientInvoices.length ? clientInvoices.map(function(inv){
              return '<tr class="clickable" data-open-invoice="'+inv.id+'"><td class="num">'+esc(inv.number)+'</td><td class="muted">'+esc(inv.projectTitle||"—")+'</td><td>'+(inv.type==="tax"?"Tax":"Proforma")+'</td><td>'+fmtDate(inv.date)+'</td><td class="num">'+fmtMoney(inv.total)+'</td></tr>';
            }).join("") : '<tr class="empty-row"><td colspan="5">No invoices yet for this client.</td></tr>')+
            '</tbody></table>'+
          '</div>'+
        '</div>'+
        '<div>'+
          '<div class="section-title">Client info</div>'+
          '<div class="card" style="padding:18px 20px;">'+
            '<dl class="kv">'+
              '<dt>Phone</dt><dd>'+esc(c.phone||"—")+'</dd>'+
              '<dt>Email</dt><dd>'+esc(c.email||"—")+'</dd>'+
              '<dt>GSTIN</dt><dd>'+esc(c.gstin||"—")+'</dd>'+
              '<dt>State</dt><dd>'+esc(c.state||"—")+'</dd>'+
              '<dt>Address</dt><dd>'+esc(c.address||"—")+'</dd>'+
            '</dl>'+
            (c.notes? '<div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--line); font-size:12.5px; color:var(--muted);">'+esc(c.notes)+'</div>' : '')+
          '</div>'+
        '</div>'+
      '</div>';
    $("#clientDetailBody").innerHTML = html;
    showView("client-detail");
  }

  // ---------------- Rendering: Project detail ----------------
  function renderProjectDetail(id){
    var p = projects[id];
    if(!p){ showView("clients"); return; }
    currentProjectId = id;
    currentClientId = p.clientId;
    var client = clients[p.clientId] || {};
    var paid = calcProjectPaid(id), total = Number(p.totalAmount)||0, pending = total-paid;
    var pct = total? Math.min(100, Math.round(paid/total*100)) : 0;
    var pays = (projectPayments[id]||[]).slice().sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); });
    var projInvoices = Object.keys(invoices).map(function(iid){ return Object.assign({id:iid}, invoices[iid]); })
      .filter(function(inv){ return inv.projectId===id; }).sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); });

    var vendorSection = "";
    if(p.isOutsourced){
      var vPays = (vendorPayments[id]||[]).slice().sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); });
      var vPaid = calcVendorPaid(id), vTotal = Number(p.vendorCost)||0, vPending = vTotal-vPaid;
      var vpct = vTotal? Math.min(100, Math.round(vPaid/vTotal*100)) : 0;
      vendorSection = ''+
        '<div class="section-title">Outsourcing — '+esc(p.vendorName||"vendor")+'</div>'+
        '<div class="stat-row stat-row-3">'+
          '<div class="card stat"><div class="label">Vendor Cost</div><div class="value num">'+fmtMoney(vTotal)+'</div></div>'+
          '<div class="card stat"><div class="label">Paid to Vendor</div><div class="value num" style="color:var(--success)">'+fmtMoney(vPaid)+'</div><div class="delta"><div class="bar" style="margin-top:4px;"><span style="width:'+vpct+'%"></span></div></div></div>'+
          '<div class="card stat"><div class="label">Owed to Vendor</div><div class="value num" style="color:'+(vPending>0?"var(--danger)":"var(--success)")+'">'+fmtMoney(vPending)+'</div></div>'+
        '</div>'+
        '<div class="card" style="padding:16px 20px; margin-bottom:8px;">'+
          (p.vendorPhone? '<div class="muted" style="font-size:12.5px; margin-bottom:8px;">Phone: '+esc(p.vendorPhone)+'</div>' : '')+
          (p.vendorNotes? '<div style="font-size:12.5px; margin-bottom:10px;">'+esc(p.vendorNotes)+'</div>' : '')+
          (vPays.length ? vPays.map(function(v){
            return '<div class="pay-row"><div><b class="num">'+fmtMoney(v.amount)+'</b> <span class="muted">via '+esc(v.mode)+'</span>'+(v.note?' — '+esc(v.note):'')+'</div><div class="muted">'+fmtDate(v.date)+'</div></div>';
          }).join("") : '<div class="muted" style="padding:8px 0;">No vendor payments recorded yet.</div>')+
        '</div>'+
        '<div style="margin-bottom:26px;"><button class="btn btn-ghost btn-sm" data-action="record-vendor-payment" data-project-id="'+id+'">+ Record Payment To Vendor</button></div>';
    }

    var html = ''+
      '<div class="detail-head">'+
        '<div><h1>'+esc(p.title)+'</h1><div class="sub" style="color:var(--muted); margin-top:4px;">'+esc(client.name||"—")+' · Started '+fmtDate(p.startDate)+'</div></div>'+
        '<div style="display:flex; gap:10px; flex-wrap:wrap;">'+
          '<button class="btn btn-ghost btn-sm" data-action="cashflow-for" data-scope="p:'+id+'">Cash flow</button>'+
          '<button class="btn btn-ghost btn-sm" data-action="edit-project" data-id="'+id+'">Edit</button>'+
          '<button class="btn btn-primary btn-sm" data-action="record-payment" data-project-id="'+id+'">+ Record Payment</button>'+
          '<button class="btn btn-accent btn-sm" data-action="invoice-for-project" data-client-id="'+p.clientId+'" data-project-id="'+id+'">+ Generate Invoice</button>'+
        '</div>'+
      '</div>'+
      '<div style="display:flex; gap:8px; margin-bottom:16px;">'+statusPill(p.status)+outsourcedTag(p)+'</div>'+
      (p.description? '<div class="card" style="padding:14px 18px; margin-bottom:20px; font-size:13px;">'+esc(p.description)+'</div>' : '')+
      '<div class="stat-row stat-row-3">'+
        '<div class="card stat"><div class="label">Project Value</div><div class="value num">'+fmtMoney(total)+'</div></div>'+
        '<div class="card stat"><div class="label">Received</div><div class="value num" style="color:var(--success)">'+fmtMoney(paid)+'</div><div class="delta"><div class="bar" style="margin-top:4px;"><span style="width:'+pct+'%"></span></div></div></div>'+
        '<div class="card stat"><div class="label">Pending</div><div class="value num" style="color:'+(pending>0?"var(--danger)":"var(--success)")+'">'+fmtMoney(pending)+'</div></div>'+
      '</div>'+
      '<div class="section-title">Payment history (client → you)</div>'+
      '<div class="card" style="padding:16px 20px; margin-bottom:26px;">'+
        (pays.length ? pays.map(function(pay){
          var rcId = receiptsByPayment[pay.id];
          var rcBtn = rcId
            ? '<button class="btn btn-ghost btn-sm" data-open-receipt="'+rcId+'">View receipt</button>'
            : '<button class="btn btn-ghost btn-sm" data-action="receipt-for-payment" data-payment-id="'+pay.id+'">Receipt</button>';
          return '<div class="pay-row"><div><b class="num">'+fmtMoney(pay.amount)+'</b> <span class="muted">via '+esc(pay.mode)+(pay.month?' · '+fmtMonth(pay.month):'')+'</span>'+(pay.note?' — '+esc(pay.note):'')+'</div><div style="display:flex; gap:12px; align-items:center;"><span class="muted">'+fmtDate(pay.date)+'</span>'+rcBtn+'</div></div>';
        }).join("") : '<div class="muted" style="padding:8px 0;">No payments recorded yet for this project.</div>')+
      '</div>'+
      vendorSection+
      '<div class="section-title">Invoices for this project</div>'+
      '<div class="table-wrap">'+
        '<table><thead><tr><th>Number</th><th>Type</th><th>Date</th><th class="num">Amount</th></tr></thead><tbody>'+
        (projInvoices.length ? projInvoices.map(function(inv){
          return '<tr class="clickable" data-open-invoice="'+inv.id+'"><td class="num">'+esc(inv.number)+'</td><td>'+(inv.type==="tax"?"Tax":"Proforma")+'</td><td>'+fmtDate(inv.date)+'</td><td class="num">'+fmtMoney(inv.total)+'</td></tr>';
        }).join("") : '<tr class="empty-row"><td colspan="4">No invoices yet for this project.</td></tr>')+
        '</tbody></table>'+
      '</div>';
    $("#projectDetailBody").innerHTML = html;
    showView("project-detail");
  }

  // ---------------- Rendering: Invoices ----------------
  function renderInvoicesTable(){
    var ids = Object.keys(invoices).sort(function(a,b){ return (invoices[b].date||"").localeCompare(invoices[a].date||""); });
    var body = $("#invoicesBody");
    if(!ids.length){ body.innerHTML = '<tr class="empty-row"><td colspan="7">No invoices yet — click "New Invoice" to create one.</td></tr>'; return; }
    body.innerHTML = ids.map(function(id){
      var inv = Object.assign({id:id}, invoices[id]);
      return '<tr class="clickable" data-open-invoice="'+inv.id+'">'+
        '<td class="num">'+esc(inv.number)+'</td>'+
        '<td class="name-cell">'+esc(inv.clientName)+'</td>'+
        '<td class="muted">'+esc(inv.projectTitle||"—")+'</td>'+
        '<td>'+(inv.type==="tax"?'<span class="pill pill-success"><span class="pill-dot"></span>Tax</span>':'<span class="pill pill-muted"><span class="pill-dot"></span>Proforma</span>')+'</td>'+
        '<td>'+fmtDate(inv.date)+'</td>'+
        '<td class="num">'+fmtMoney(inv.total)+'</td>'+
        '<td class="muted">View →</td>'+
      '</tr>';
    }).join("");
  }

  function renderInvoicePreview(id){
    var inv = invoices[id];
    if(!inv) return;
    var s = settings || BUSINESS_DEFAULT;
    var client = clients[inv.clientId] || {};
    var sameState = (client.state) === (s.state||"Delhi");
    var isTax = inv.type==="tax";
    $("#invPreviewTitle").textContent = (isTax?"Tax Invoice ":"Proforma Invoice ") + inv.number + (inv.isImported?" (logged)":"");

    var itemsHTML = inv.items.map(function(it, idx){
      return '<tr><td class="num">'+(idx+1)+'</td>'+
        '<td class="desc">'+esc(it.description)+'</td>'+
        '<td>'+esc(it.hsn||"")+'</td>'+
        '<td class="num">'+fmtMoneyDoc(it.amount)+'</td></tr>';
    }).join("");

    var taxRowsHTML = "";
    if(sameState){
      taxRowsHTML = '<div class="inv-totals-row"><span class="lbl">CGST @ '+(inv.gstRate/2)+'%</span><span class="val">'+fmtMoneyDoc(inv.cgst)+'</span></div>'+
                    '<div class="inv-totals-row"><span class="lbl">SGST @ '+(inv.gstRate/2)+'%</span><span class="val">'+fmtMoneyDoc(inv.sgst)+'</span></div>';
    } else {
      taxRowsHTML = '<div class="inv-totals-row"><span class="lbl">IGST @ '+inv.gstRate+'%</span><span class="val">'+fmtMoneyDoc(inv.igst)+'</span></div>';
    }

    var advanceHTML = "";
    if(Number(inv.advancePercent) > 0){
      advanceHTML = '<div class="inv-advance-banner"><span>Advance Payable Now ('+inv.advancePercent+'%)</span><span class="val">'+fmtMoneyDoc(inv.advanceAmount)+'</span></div>'+
        '<div class="inv-balance-row"><span>Balance (on completion of agreed tasks)</span><span class="val">'+fmtMoneyDoc(inv.balanceAmount)+'</span></div>';
    }

    var attnLine = client.contactName ? ('Attn: '+esc(client.contactName)+(client.contactTitle?' ('+esc(client.contactTitle)+')':'')+'<br>') : '';
    var clientGstinLine = client.gstin ? ('GSTIN: '+esc(client.gstin)+'<br>') : '';

    var metaRows = '<div><span>'+(isTax?'Invoice No:':'PI No:')+'</span><b>'+esc(inv.number)+'</b></div>'+
      '<div><span>Date:</span><b>'+fmtDate(inv.date)+'</b></div>'+
      (isTax
        ? (inv.dueDate ? '<div><span>Due:</span><b>'+fmtDate(inv.dueDate)+'</b></div>' : '')
        : (inv.validTill ? '<div><span>Valid Till:</span><b>'+fmtDate(inv.validTill)+'</b></div>' : ''));

    var termsList = isTax
      ? [
          'This is a Tax Invoice issued under GST for services rendered.',
          'Payment should be made by the due date mentioned above via bank transfer or UPI.',
          'Please quote the invoice number in all related correspondence.',
          'GST rate and SAC/HSN code to be reconfirmed with your accountant before filing.'
        ]
      : [
          'This is a Proforma Invoice for advance payment; a Tax Invoice will be issued on receipt.',
          Number(inv.advancePercent)>0
            ? 'Work commences on receipt of the '+inv.advancePercent+'% advance payment.'
            : 'Work commences on receipt of payment as agreed.',
          Number(inv.advancePercent)>0
            ? 'Balance '+(100-Number(inv.advancePercent))+'% is due on completion of the agreed tasks/services.'
            : 'Balance, if any, is due on completion of the agreed tasks/services.',
          'GST rate and SAC code to be reconfirmed with your accountant before filing.'
        ];

    var html = ''+
      '<div class="inv-bar top"></div>'+
      '<div class="inv-wrap">'+
        '<div class="inv-head">'+
          '<div>'+
            '<div class="nw-badge">NW</div>'+
            '<div class="inv-brand-name">'+esc(s.legalName)+'</div>'+
            '<div class="inv-brand-tagline">'+esc(s.tagline)+'</div>'+
          '</div>'+
          '<div class="inv-title-block">'+
            '<h2>'+(isTax?"TAX INVOICE":"PROFORMA INVOICE")+'</h2>'+
            '<div class="inv-title-underline"></div>'+
            '<div class="inv-meta">'+metaRows+'</div>'+
          '</div>'+
        '</div>'+

        '<div class="fb-box">'+
          '<div class="fb-col">'+
            '<div class="fb-label">From</div>'+
            '<div class="fb-name">'+esc(s.legalName)+(s.ownerName?' ('+esc(s.ownerName)+')':'')+'</div>'+
            '<div class="fb-detail">'+esc(s.address)+'<br>GSTIN: '+esc(s.gstin)+'<br>Phone: '+esc(s.phone)+'<br>Email: '+esc(s.email)+'</div>'+
          '</div>'+
          '<div class="fb-col">'+
            '<div class="fb-label">Bill To</div>'+
            '<div class="fb-name">'+esc(client.name||inv.clientName||"—")+'</div>'+
            '<div class="fb-detail">'+esc(client.address||"")+(client.address?'<br>':'')+attnLine+
              (client.phone?('Mob: '+esc(client.phone)+'<br>'):'')+
              (client.email?('Email: '+esc(client.email)+'<br>'):'')+
              clientGstinLine+
            '</div>'+
          '</div>'+
        '</div>'+

        '<table class="inv-table">'+
          '<thead><tr><th class="sno">S.No</th><th>Description of Service</th><th>SAC Code</th><th class="num">Amount (₹)</th></tr></thead>'+
          '<tbody>'+itemsHTML+'</tbody>'+
        '</table>'+

        '<div class="inv-totals-wrap"><div class="inv-totals">'+
          '<div class="inv-totals-row"><span class="lbl">Subtotal</span><span class="val">'+fmtMoneyDoc(inv.subtotal)+'</span></div>'+
          taxRowsHTML+
          '<div class="inv-totals-row grand"><span class="lbl">'+(isTax?"Total Invoice Value":"Total Project Value")+'</span><span class="val">'+fmtMoneyDoc(inv.total)+'</span></div>'+
          advanceHTML+
        '</div></div>'+

        (inv.notes ? '<div class="inv-terms-box"><b>Payment terms:</b> '+esc(inv.notes)+'</div>' : '')+

        '<div class="inv-lower">'+
          '<div class="inv-lower-box">'+
            '<div class="inv-lower-label">Bank Details for Payment</div>'+
            '<div class="inv-bank-row"><span class="lbl">Account Holder</span><span class="val">'+esc(s.bank.accountName)+'</span></div>'+
            '<div class="inv-bank-row"><span class="lbl">Account Number</span><span class="val">'+esc(s.bank.accountNumber)+'</span></div>'+
            '<div class="inv-bank-row"><span class="lbl">IFSC Code</span><span class="val">'+esc(s.bank.ifsc)+'</span></div>'+
            '<div class="inv-bank-row"><span class="lbl">Bank &amp; Branch</span><span class="val">'+esc(s.bank.bankName)+', '+esc(s.bank.branch)+'</span></div>'+
          '</div>'+
          '<div class="inv-lower-box">'+
            '<div class="inv-lower-label">Terms &amp; Notes</div>'+
            '<ol class="inv-notes-list">'+termsList.map(function(t){ return '<li>'+esc(t)+'</li>'; }).join("")+'</ol>'+
          '</div>'+
        '</div>'+

        '<div class="inv-sign">'+
          '<div>For '+esc(client.name||inv.clientName||"")+'</div>'+
          '<div>For '+esc(s.legalName)+(s.ownerName?' — '+esc(s.ownerName):'')+'</div>'+
        '</div>'+

        '<div class="inv-doc-foot">'+esc(s.website)+' | '+esc(s.phone)+' | '+esc(s.email)+' | GSTIN: '+esc(s.gstin)+'</div>'+
      '</div>'+
      '<div class="inv-bar bottom"></div>';
    $("#printArea").innerHTML = html;
    showView("invoice-preview");
  }

  // ---------------- Receipts (payment receipts — never show GST) ----------------
  function amountInWordsINR(n){
    n = Math.round((Number(n)||0)*100)/100;
    var rupees = Math.floor(n + 1e-9);
    var paise = Math.round((n - rupees)*100);
    if(paise >= 100){ rupees += 1; paise = 0; }
    var words = rupees > 0 ? "Rupees " + numberToWordsIndian(rupees) : "";
    if(paise > 0) words += (words ? " and " : "") + twoDigits(paise) + " Paise";
    return (words || "Zero Rupees") + " Only";
  }

  function renderReceiptsTable(){
    var body = $("#receiptsBody");
    if(receiptsError){
      body.innerHTML = '<tr class="empty-row"><td colspan="7">'+esc(receiptsError)+'</td></tr>';
      return;
    }
    var ids = Object.keys(receipts).sort(function(a,b){
      return (receipts[b].date||"").localeCompare(receipts[a].date||"") || (Number(b)-Number(a));
    });
    if(!ids.length){
      body.innerHTML = '<tr class="empty-row"><td colspan="7">No receipts yet — click "New Receipt", or use the Receipt button next to a recorded payment on a project page.</td></tr>';
      return;
    }
    body.innerHTML = ids.map(function(id){
      var r = receipts[id];
      return '<tr class="clickable" data-open-receipt="'+id+'">'+
        '<td class="num">'+esc(r.number)+'</td>'+
        '<td class="name-cell">'+esc(r.clientName)+'</td>'+
        '<td class="muted">'+esc(r.description || r.projectTitle || "—")+'</td>'+
        '<td>'+fmtDate(r.date)+'</td>'+
        '<td>'+esc(r.mode)+'</td>'+
        '<td class="num">'+fmtMoney(r.amount)+'</td>'+
        '<td class="muted">View →</td>'+
      '</tr>';
    }).join("");
  }

  function renderReceiptPreview(id){
    var r = receipts[id];
    if(!r) return;
    currentReceiptId = id;
    var s = settings || BUSINESS_DEFAULT;
    var client = clients[r.clientId] || {};
    $("#receiptPreviewTitle").textContent = "Payment Receipt " + r.number;

    var longDate = function(iso){ var d = new Date((iso||"")+"T00:00:00"); return isNaN(d) ? (iso||"—") : d.toLocaleDateString("en-IN", {day:"numeric", month:"long", year:"numeric"}); };
    var meta = function(l, v){ return v ? '<div class="rp-meta-row"><span>'+l+'</span><b>'+esc(v)+'</b></div>' : ''; };
    var lines = function(arr){ return arr.filter(Boolean).map(esc).join("<br>"); };
    var billLines = lines([
      client.name || r.clientName || "",
      client.address || "",
      client.contactName ? ("Attn: "+client.contactName+(client.contactTitle?" ("+client.contactTitle+")":"")) : "",
      client.phone || "", client.email || ""
    ]);
    var fromLines = lines([s.address, s.phone, s.email, s.website]);
    var desc = r.description || r.projectTitle || "Payment received";

    var html = ''+
      '<div class="rp">'+
        '<div class="rp-top">'+
          '<h2>Receipt</h2>'+
          '<img class="rp-logo" src="'+LOGO_ICON+'" alt="">'+
        '</div>'+
        '<div class="rp-meta">'+
          meta("Receipt number", r.number)+
          meta("Date paid", longDate(r.date))+
          meta("Payment method", r.mode)+
          meta("Reference", r.reference)+
          meta("Project", r.projectTitle)+
        '</div>'+
        '<div class="rp-parties">'+
          '<div><div class="rp-h">'+esc(s.legalName)+'</div><div class="rp-t">'+fromLines+'</div></div>'+
          '<div><div class="rp-h">Bill to</div><div class="rp-t">'+billLines+'</div></div>'+
        '</div>'+
        '<div class="rp-paid">'+fmtMoneyDoc(r.amount)+' paid on '+longDate(r.date)+'</div>'+
        '<table class="rp-table">'+
          '<thead><tr><th>Description</th><th class="rp-qty">Qty</th><th class="rp-amt">Amount</th></tr></thead>'+
          '<tbody><tr><td>'+esc(desc)+'</td><td class="rp-qty">1</td><td class="rp-amt">'+fmtMoneyDoc(r.amount)+'</td></tr></tbody>'+
        '</table>'+
        '<div class="rp-totals">'+
          '<div><span>Total</span><span>'+fmtMoneyDoc(r.amount)+'</span></div>'+
          '<div class="rp-strong"><span>Amount paid</span><span>'+fmtMoneyDoc(r.amount)+'</span></div>'+
        '</div>'+
        '<div class="rp-words">Amount in words: '+esc(amountInWordsINR(r.amount))+'</div>'+
        (r.notes ? '<div class="rp-note"><b>Note</b><br>'+esc(r.notes)+'</div>' : '')+
        '<div class="rp-foot">This receipt acknowledges payment received'+(r.mode==="Cheque"?' (cheque payments are subject to realisation)':'')+'. '+
          'Questions about this receipt? Contact '+esc(s.email || s.phone || s.legalName)+'.</div>'+
      '</div>';
    $("#receiptPrintArea").innerHTML = html;
    showView("receipt-preview");
  }

  var receiptAutoDesc = "";
  function receiptAutoDescFor(projectId){
    var p = projects[projectId];
    return p ? "Payment towards " + p.title : "";
  }
  function populateReceiptProjects(clientId, selected){
    var list = clientId ? projectsForClient(clientId) : [];
    $("#rProject").innerHTML = '<option value="">— No project —</option>' +
      list.map(function(p){ return '<option value="'+p.id+'">'+esc(p.title)+'</option>'; }).join("");
    if(selected) $("#rProject").value = selected;
  }
  // Keep the "Payment towards" text in step with the chosen project, but never
  // overwrite something the person has typed themselves.
  function syncReceiptDescription(){
    var cur = $("#rDescription").value.trim();
    if(cur === "" || cur === receiptAutoDesc){
      receiptAutoDesc = receiptAutoDescFor($("#rProject").value);
      $("#rDescription").value = receiptAutoDesc;
    }
  }
  function openReceiptModal(clientId, projectId){
    if(receiptsError){ toast(receiptsError); return; }
    if(!Object.keys(clients).length){ toast("Add a client first"); return; }
    populateClientSelect($("#rClient"), clientId);
    populateReceiptProjects($("#rClient").value, projectId);
    receiptAutoDesc = "";
    $("#rDescription").value = "";
    syncReceiptDescription();
    $("#rAmount").value = "";
    $("#rDate").value = todayISO();
    $("#rMode").value = "Bank Transfer";
    $("#rReference").value = "";
    $("#rNotes").value = "";
    $("#rClient").onchange = function(){ populateReceiptProjects($("#rClient").value, null); syncReceiptDescription(); };
    $("#rProject").onchange = syncReceiptDescription;
    openModal("receiptModalBackdrop");
  }

  function saveReceipt(){
    var clientId = $("#rClient").value;
    if(!clientId || !clients[clientId]){ toast("Pick a client first"); return; }
    var amount = Number($("#rAmount").value);
    if(!amount || amount <= 0){ toast("Enter the amount received"); return; }
    var projectId = $("#rProject").value;
    var payload = {
      op: "create", client_id: Number(clientId), project_id: projectId ? Number(projectId) : null,
      amount: amount, date: $("#rDate").value || todayISO(), mode: $("#rMode").value,
      reference: $("#rReference").value.trim(), description: $("#rDescription").value.trim(),
      notes: $("#rNotes").value.trim()
    };
    api("api/receipts.php", {method:"POST", body: JSON.stringify(payload)})
      .then(function(result){
        closeModals(); toast("Receipt "+result.number+" created");
        return refreshAndRender().then(function(){ renderReceiptPreview(String(result.id)); });
      })
      .catch(function(err){ toast("Couldn't save: "+err.message); });
  }

  // One click from a recorded payment: the server builds the receipt from the
  // payment itself, and returns the existing one if it was already made.
  function receiptForPayment(paymentId){
    if(receiptsError){ toast(receiptsError); return; }
    api("api/receipts.php", {method:"POST", body: JSON.stringify({op:"create", payment_id: Number(paymentId)})})
      .then(function(result){
        toast(result.existing ? "Opening receipt "+result.number : "Receipt "+result.number+" created");
        return refreshAndRender().then(function(){ renderReceiptPreview(String(result.id)); });
      })
      .catch(function(err){ toast("Couldn't create receipt: "+err.message); });
  }

  function deleteReceipt(){
    var r = receipts[currentReceiptId];
    if(!r) return;
    if(!window.confirm("Delete receipt "+r.number+"? This can't be undone, and the number won't be reused.")) return;
    api("api/receipts.php", {method:"POST", body: JSON.stringify({op:"delete", id: Number(currentReceiptId)})})
      .then(function(){ toast("Receipt deleted"); return refreshAndRender(); })
      .then(function(){ currentReceiptId = null; showView("receipts"); })
      .catch(function(err){ toast("Couldn't delete: "+err.message); });
  }

  // ---------------- Rendering: Outsourcing ----------------
  function renderOutsourcing(){
    var list = Object.keys(projects).map(function(id){ return Object.assign({id:id}, projects[id]); }).filter(function(p){ return p.isOutsourced; });
    var totalCost = 0, totalPaid = 0;
    list.forEach(function(p){ totalCost += Number(p.vendorCost)||0; totalPaid += calcVendorPaid(p.id); });
    $("#outStatCount").textContent = list.length;
    $("#outStatCost").textContent = fmtMoney(totalCost);
    $("#outStatPending").textContent = fmtMoney(totalCost-totalPaid);

    var body = $("#outsourcingBody");
    if(!list.length){ body.innerHTML = '<tr class="empty-row"><td colspan="6">No outsourced projects yet. Tick "outsourced" on a project to track it here.</td></tr>'; return; }
    body.innerHTML = list.map(function(p){
      var client = clients[p.clientId] || {};
      var vPaid = calcVendorPaid(p.id), vTotal = Number(p.vendorCost)||0, vPending = vTotal-vPaid;
      return '<tr class="clickable" data-open-project="'+p.id+'">'+
        '<td class="name-cell">'+esc(client.name||"—")+'</td>'+
        '<td class="muted">'+esc(p.title)+'</td>'+
        '<td>'+esc(p.vendorName||"—")+'</td>'+
        '<td class="num">'+fmtMoney(vTotal)+'</td>'+
        '<td class="num">'+fmtMoney(vPaid)+'</td>'+
        '<td class="num" style="color:'+(vPending>0?"var(--danger)":"var(--success)")+'; font-weight:700;">'+fmtMoney(vPending)+'</td>'+
      '</tr>';
    }).join("");
  }

  // ---------------- Rendering: Cash Flow ----------------
  function cashTypePill(type){
    return type === "income"
      ? '<span class="pill pill-success"><span class="pill-dot"></span>Income</span>'
      : '<span class="pill pill-danger"><span class="pill-dot"></span>Expense</span>';
  }
  function planStatusPill(status){
    return status === "unplanned"
      ? '<span class="pill pill-warning"><span class="pill-dot"></span>Unplanned</span>'
      : '<span class="pill pill-muted"><span class="pill-dot"></span>Planned</span>';
  }
  // Everything that moved money in the selected view, from ONE place each:
  //  - cash_entries       -> general income / expenses (rent, subscriptions…)
  //  - project payments   -> money clients paid you (read straight from the project)
  //  - vendor payments    -> money you paid outsourcing vendors
  function cashRows(){
    var rows = [];
    cashEntries.forEach(function(e){
      rows.push({src:"entry", id:e.id, date:e.date, month:e.month, title:e.title, clientId:e.clientId, projectId:e.projectId,
        clientName:e.clientName, projectTitle:e.projectTitle, category:e.category, type:e.entryType, plan:e.planStatus, note:e.note, amount:e.amount});
    });
    Object.keys(projectPayments).forEach(function(pid){
      var p = projects[pid]; if(!p) return; var cl = clients[p.clientId] || {};
      projectPayments[pid].forEach(function(pay){
        rows.push({src:"payment", id:pay.id, date:pay.date, month:String(pay.date||"").slice(0,7),
          title:"Client payment"+(pay.month ? " ("+fmtMonth(pay.month)+")" : ""), clientId:p.clientId, projectId:pid, clientName:cl.name||"", projectTitle:p.title,
          category:"Project payment", type:"income", plan:"planned", note:pay.note||"", amount:pay.amount});
      });
    });
    Object.keys(vendorPayments).forEach(function(pid){
      var p = projects[pid]; if(!p) return; var cl = clients[p.clientId] || {};
      vendorPayments[pid].forEach(function(v){
        rows.push({src:"vendor", id:v.id, date:v.date, month:String(v.date||"").slice(0,7),
          title:"Vendor payment — "+(p.vendorName||"outsourcing"), clientId:p.clientId, projectId:pid, clientName:cl.name||"", projectTitle:p.title,
          category:"Outsourcing", type:"expense", plan:"planned", note:v.note||"", amount:v.amount});
      });
    });
    rows.sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); });
    return rows;
  }
  function cashScopeMatch(scope, clientId, projectId){
    if(!scope) return true;
    var kind = scope.charAt(0), id = scope.slice(2);
    return kind === "c" ? String(clientId) === id : String(projectId) === id;
  }
  function buildCashScopeOptions(selected){
    var sel = $("#cashScope"), html = '<option value="">All clients &amp; projects</option>';
    Object.keys(clients).sort(function(a,b){ return clients[a].name.localeCompare(clients[b].name); }).forEach(function(cid){
      html += '<option value="c:'+cid+'">'+esc(clients[cid].name)+' (all projects)</option>';
      projectsForClient(cid).forEach(function(p){ html += '<option value="p:'+p.id+'">&nbsp;&nbsp;↳ '+esc(p.title)+'</option>'; });
    });
    sel.innerHTML = html;
    sel.value = selected || "";
    if(sel.value !== (selected||"")) sel.value = "";
  }

  function renderCashflow(){
    var monthInput = $("#cashMonth");
    if(!monthInput) return;
    if(!monthInput.value) monthInput.value = currentMonthISO();
    var allMonths = $("#cashAllMonths").checked;
    monthInput.disabled = allMonths;
    var selectedMonth = monthInput.value;
    buildCashScopeOptions($("#cashScope").value);
    var scope = $("#cashScope").value;
    var categoryFilter = $("#cashCategoryFilter");
    var selectedCategory = categoryFilter.value;

    var all = cashRows().filter(function(r){ return (allMonths || r.month === selectedMonth) && cashScopeMatch(scope, r.clientId, r.projectId); });
    var categories = all.map(function(r){ return r.category; }).filter(function(c, i, l){ return c && l.indexOf(c) === i; }).sort(function(a,b){ return a.localeCompare(b); });
    categoryFilter.innerHTML = '<option value="">All categories</option>' + categories.map(function(c){ return '<option value="'+esc(c)+'">'+esc(c)+'</option>'; }).join("");
    categoryFilter.value = categories.indexOf(selectedCategory) !== -1 ? selectedCategory : "";
    selectedCategory = categoryFilter.value;
    var list = all.filter(function(r){ return !selectedCategory || r.category === selectedCategory; });

    var income = 0, expense = 0, planned = 0, unplanned = 0, incN = 0;
    list.forEach(function(r){
      if(r.type === "income"){ income += r.amount; incN++; } else expense += r.amount;
      if(r.plan === "planned") planned += r.amount; else unplanned += r.amount;
    });
    var net = income - expense;
    var periodLabel = allMonths ? "All months" : fmtMonth(selectedMonth);
    $("#cashIncome").textContent = fmtMoney(income);
    $("#cashIncomeSub").textContent = incN + " income entr" + (incN === 1 ? "y" : "ies");
    $("#cashExpense").textContent = fmtMoney(expense);
    $("#cashExpenseSub").textContent = fmtMoney(unplanned) + " unplanned";
    $("#cashNet").textContent = fmtMoney(net);
    $("#cashNet").style.color = net < 0 ? "var(--danger)" : "var(--success)";
    $("#cashNetSub").textContent = periodLabel + " · " + fmtMoney(planned) + " planned";

    var body = $("#cashEntriesBody");
    if(!list.length){
      body.innerHTML = '<tr class="empty-row"><td colspan="9">No cash-flow entries for '+esc(periodLabel)+'. Add your first entry.</td></tr>';
    } else {
      body.innerHTML = list.map(function(r){
        var who = esc(r.clientName || "—") + (r.projectTitle ? '<div class="muted" style="font-size:11.5px;">'+esc(r.projectTitle)+'</div>' : '');
        var actions;
        if(r.src === "entry") actions = '<button class="btn btn-ghost btn-sm" data-action="edit-cash-entry" data-id="'+r.id+'">Edit</button><button class="icon-btn" title="Delete entry" data-action="delete-cash-entry" data-id="'+r.id+'">×</button>';
        else actions = '<button class="btn btn-ghost btn-sm" data-open-project="'+r.projectId+'">Open project</button><button class="icon-btn" title="Delete this payment" data-action="'+(r.src==="payment"?"delete-payment-row":"delete-vendor-row")+'" data-id="'+r.id+'">×</button>';
        return '<tr>'+
          '<td>'+fmtDate(r.date)+'</td>'+
          '<td class="name-cell">'+esc(r.title)+'</td>'+
          '<td>'+who+'</td>'+
          '<td>'+esc(r.category || "—")+'</td>'+
          '<td>'+cashTypePill(r.type)+'</td>'+
          '<td>'+planStatusPill(r.plan)+'</td>'+
          '<td class="muted">'+esc(r.note || "—")+'</td>'+
          '<td class="num" style="font-weight:700; color:'+(r.type === "income" ? "var(--success)" : "var(--danger)")+';">'+(r.type === "income" ? "+" : "−")+fmtMoney(r.amount)+'</td>'+
          '<td><div class="row-actions">'+actions+'</div></td>'+
        '</tr>';
      }).join("");
    }
    renderBalanceSheet(scope);
  }

  // Project cost vs. money actually received, per project (all time) — the "balance sheet".
  function renderBalanceSheet(scope){
    var ids = Object.keys(projects).filter(function(pid){ return cashScopeMatch(scope, projects[pid].clientId, pid); });
    var tot = {cost:0, paid:0, vCost:0, vPaid:0};
    var rows = ids.map(function(pid){
      var p = projects[pid], cost = Number(p.totalAmount)||0, paid = calcProjectPaid(pid);
      var vCost = p.isOutsourced ? (Number(p.vendorCost)||0) : 0, vPaid = calcVendorPaid(pid);
      tot.cost += cost; tot.paid += paid; tot.vCost += vCost; tot.vPaid += vPaid;
      return {pid:pid, p:p, cost:cost, paid:paid, pending:cost-paid, vCost:vCost, vPaid:vPaid, margin:cost-vCost};
    }).sort(function(a,b){ return b.pending - a.pending; });
    var pending = tot.cost - tot.paid, owed = Math.max(0, tot.vCost - tot.vPaid);
    $("#bsCards").innerHTML =
      '<div class="card stat"><div class="label">Project value</div><div class="value num">'+fmtMoney(tot.cost)+'</div><div class="delta">'+rows.length+' project(s)</div></div>'+
      '<div class="card stat"><div class="label">Received</div><div class="value num" style="color:var(--success)">'+fmtMoney(tot.paid)+'</div><div class="delta">'+(tot.cost? Math.round(tot.paid/tot.cost*100) : 0)+'% collected</div></div>'+
      '<div class="card stat"><div class="label">Pending to receive</div><div class="value num" style="color:'+(pending>0?"var(--danger)":"var(--success)")+'">'+fmtMoney(pending)+'</div><div class="delta">from clients</div></div>'+
      '<div class="card stat"><div class="label">Owed to vendors</div><div class="value num" style="color:'+(owed>0?"var(--danger)":"var(--success)")+'">'+fmtMoney(owed)+'</div><div class="delta">'+fmtMoney(tot.vPaid)+' paid so far</div></div>';
    var body = $("#bsBody");
    if(!rows.length){ body.innerHTML = '<tr class="empty-row"><td colspan="8">No projects yet.</td></tr>'; return; }
    body.innerHTML = rows.map(function(r){
      var cl = clients[r.p.clientId] || {};
      return '<tr class="clickable" data-open-project="'+r.pid+'">'+
        '<td class="name-cell">'+esc(r.p.title)+'</td>'+
        '<td>'+esc(cl.name||"—")+'</td>'+
        '<td class="num">'+fmtMoney(r.cost)+'</td>'+
        '<td class="num" style="color:var(--success)">'+fmtMoney(r.paid)+'</td>'+
        '<td class="num" style="color:'+(r.pending>0?"var(--danger)":"var(--success)")+'">'+fmtMoney(r.pending)+'</td>'+
        '<td class="num">'+(r.vCost? fmtMoney(r.vCost) : "—")+'</td>'+
        '<td class="num">'+(r.vCost || r.vPaid ? fmtMoney(r.vPaid) : "—")+'</td>'+
        '<td class="num">'+fmtMoney(r.margin)+'</td>'+
      '</tr>';
    }).join("");
  }

  function goCashflowFor(scope){
    $("#cashAllMonths").checked = true;
    buildCashScopeOptions(scope);
    navTo("cashflow");
  }

  // ----- Cash entry modal: client -> project -> "recorded as project payment" -----
  function fillCeProjects(clientId, selected){
    var ids = Object.keys(projects).filter(function(pid){ return !clientId || projects[pid].clientId === clientId; })
      .sort(function(a,b){ return projects[a].title.localeCompare(projects[b].title); });
    $("#ceProjectId").innerHTML = '<option value="">— No project —</option>' + ids.map(function(pid){
      var c = clients[projects[pid].clientId] || {};
      return '<option value="'+pid+'">'+esc(projects[pid].title)+(clientId ? '' : ' — '+esc(c.name||""))+'</option>';
    }).join("");
    $("#ceProjectId").value = selected && ids.indexOf(String(selected)) !== -1 ? String(selected) : "";
  }
  function updateCeHint(){
    var pid = $("#ceProjectId").value, income = $("#ceType").value === "income", editing = !!$("#ceId").value;
    var hint = $("#ceProjectHint"), modeField = $("#ceModeField");
    if(pid && income){
      var p = projects[pid], pending = (Number(p.totalAmount)||0) - calcProjectPaid(pid);
      hint.style.display = ""; modeField.style.display = "";
      hint.innerHTML = (editing ? 'This entry will <b>move into</b> ' : 'Saved as a <b>payment</b> on ')+'<b>'+esc(p.title)+'</b>. Its Received and Pending update everywhere (currently pending '+fmtMoney(pending)+').';
    } else if(pid){
      hint.style.display = ""; modeField.style.display = "none";
      hint.innerHTML = 'Tagged to <b>'+esc(projects[pid].title)+'</b> as a project expense.';
    } else { hint.style.display = "none"; modeField.style.display = "none"; }
  }
  (function(){
    var c = $("#ceClientId"), p = $("#ceProjectId"), t = $("#ceType");
    if(c) c.addEventListener("change", function(){ fillCeProjects(c.value, p.value); updateCeHint(); });
    if(p) p.addEventListener("change", function(){ if(p.value) c.value = projects[p.value].clientId; updateCeHint(); });
    if(t) t.addEventListener("change", updateCeHint);
  })();

  function openCashEntryModal(id){
    var entry = id ? cashEntries.filter(function(item){ return String(item.id) === String(id); })[0] : null;
    if(id && !entry){ toast("Cash-flow entry not found"); return; }
    $("#cashEntryModalTitle").textContent = entry ? "Edit Cash Flow Entry" : "Add Cash Flow Entry";
    $("#saveCashEntryBtn").textContent = entry ? "Update Entry" : "Save Entry";
    $("#ceId").value = entry ? entry.id : "";
    $("#ceType").value = entry ? entry.entryType : "income";
    $("#cePlanStatus").value = entry ? entry.planStatus : "planned";
    $("#ceTitle").value = entry ? entry.title : "";
    $("#ceAmount").value = entry ? entry.amount : "";
    $("#ceDate").value = entry ? entry.date : todayISO();
    var clientOptions = Object.keys(clients).sort(function(a,b){ return clients[a].name.localeCompare(clients[b].name); })
      .map(function(id){ return '<option value="'+id+'">'+esc(clients[id].name)+'</option>'; }).join("");
    $("#ceClientId").innerHTML = '<option value="">Not linked to a client</option>' + clientOptions;
    $("#ceClientId").value = entry && entry.clientId ? entry.clientId : "";
    fillCeProjects($("#ceClientId").value, entry ? entry.projectId : "");
    $("#ceMode").value = "Bank Transfer";
    $("#ceCategory").value = entry ? entry.category : "";
    $("#cashCategorySuggestions").innerHTML = cashEntries.map(function(entry){ return entry.category; }).filter(function(category, index, list){ return category && list.indexOf(category) === index; })
      .sort(function(a,b){ return a.localeCompare(b); }).map(function(category){ return '<option value="'+esc(category)+'">'; }).join("");
    $("#ceNote").value = entry ? entry.note : "";
    updateCeHint();
    openModal("cashEntryModalBackdrop");
  }

  // ---------------- Letterhead ----------------
  var letterDraft = "";
  function renderLetterhead(){
    var s = settings || BUSINESS_DEFAULT;
    var html = ''+
      '<div class="doc-head">'+
        '<div><img src="'+LOGO_FULL+'" alt="NikhilWorks" class="doc-logo"><div class="addr">'+esc(s.address)+'<br>'+esc(s.email)+' · '+esc(s.phone)+' · '+esc(s.website)+'</div></div>'+
        '<div class="doc-title"><div class="meta"><div><b>'+fmtDate(todayISO())+'</b></div></div></div>'+
      '</div>'+
      '<div class="letter-editor" id="letterEditor" contenteditable="true" data-placeholder="Start typing your letter here — e.g. To Whom It May Concern, engagement confirmation, NOC, recommendation…">'+letterDraft+'</div>'+
      '<div class="doc-foot">'+esc(s.legalName)+' · GSTIN '+esc(s.gstin)+' · '+esc(s.website)+'</div>';
    $("#letterheadPaper").innerHTML = html;
    var ed = $("#letterEditor");
    ed.addEventListener("input", function(){ letterDraft = ed.innerHTML; });
  }

  // ---------------- Settings ----------------
  function renderSettings(){
    var s = settings || BUSINESS_DEFAULT;
    var html = ''+
      '<div class="field"><label>Legal business name</label><input id="sName" value="'+esc(s.legalName)+'"></div>'+
      '<div class="grid2">'+
        '<div class="field"><label>Tagline (printed under business name)</label><input id="sTagline" value="'+esc(s.tagline)+'"></div>'+
        '<div class="field"><label>Signatory name (printed on invoices)</label><input id="sOwnerName" value="'+esc(s.ownerName)+'"></div>'+
      '</div>'+
      '<div class="grid2">'+
        '<div class="field"><label>GSTIN</label><input id="sGstin" value="'+esc(s.gstin)+'"></div>'+
        '<div class="field"><label>PAN</label><input id="sPan" value="'+esc(s.pan)+'"></div>'+
      '</div>'+
      '<div class="field"><label>Registered address</label><textarea id="sAddress">'+esc(s.address)+'</textarea></div>'+
      '<div class="grid2">'+
        '<div class="field"><label>Email</label><input id="sEmail" value="'+esc(s.email)+'"></div>'+
        '<div class="field"><label>Phone</label><input id="sPhone" value="'+esc(s.phone)+'"></div>'+
      '</div>'+
      '<div class="field"><label>Website</label><input id="sWebsite" value="'+esc(s.website)+'"></div>'+
      '<div class="field"><label>Your business state (for GST place-of-supply match)</label>'+
        '<select id="sState">'+
          ['Delhi','Uttar Pradesh','Haryana','Maharashtra','Karnataka','Gujarat','West Bengal','Tamil Nadu','Telangana','Rajasthan','Punjab','Other India'].map(function(st){
            return '<option'+(s.state===st?' selected':'')+'>'+st+'</option>';
          }).join('')+
        '</select>'+
      '</div>'+
      '<div class="section-title" style="margin-top:8px;">Bank details</div>'+
      '<div class="grid2">'+
        '<div class="field"><label>Account name</label><input id="sBankName" value="'+esc(s.bank.accountName)+'"></div>'+
        '<div class="field"><label>Account number</label><input id="sBankAcc" value="'+esc(s.bank.accountNumber)+'"></div>'+
      '</div>'+
      '<div class="grid2">'+
        '<div class="field"><label>IFSC</label><input id="sBankIfsc" value="'+esc(s.bank.ifsc)+'"></div>'+
        '<div class="field"><label>Bank &amp; branch</label><input id="sBankBranch" value="'+esc(s.bank.bankName+(s.bank.branch?', '+s.bank.branch:''))+'"></div>'+
      '</div>'+
      '<div class="section-title" style="margin-top:8px;">Invoice numbering</div>'+
      '<div class="grid2">'+
        '<div class="field"><label>Tax invoice prefix / next no.</label><div style="display:flex; gap:8px;"><input id="sTaxPrefix" value="'+esc(s.taxPrefix)+'" style="width:70px;"><input id="sTaxCounter" type="number" value="'+esc(s.taxCounter)+'"></div></div>'+
        '<div class="field"><label>Proforma prefix / next no.</label><div style="display:flex; gap:8px;"><input id="sProPrefix" value="'+esc(s.proformaPrefix)+'" style="width:70px;"><input id="sProCounter" type="number" value="'+esc(s.proformaCounter)+'"></div></div>'+
      '</div>'+
      '<div class="field"><label>Proforma Invoice validity (days, printed as "Valid Till")</label><input type="number" id="sValidityDays" value="'+esc(s.proformaValidityDays)+'" style="max-width:120px;"></div>'+
      '<div class="field"><label>Payment receipt prefix / next no.</label><div style="display:flex; gap:8px;"><input id="sRecPrefix" value="'+esc(s.receiptPrefix||"RC")+'" style="width:70px;"><input id="sRecCounter" type="number" value="'+esc(s.receiptCounter||1)+'" style="max-width:140px;"></div></div>'+
      '</div>'+
      '<button class="btn btn-accent" data-action="save-settings" style="margin-top:6px;">Save Settings</button>';
    $("#settingsForm").innerHTML = html;
  }

  // ---------------- Modals ----------------
  function openModal(id){ $("#"+id).classList.add("open"); }
  function closeModals(){ $all(".modal-backdrop").forEach(function(m){ m.classList.remove("open"); }); }
  document.addEventListener("click", function(e){
    if(e.target.classList && e.target.classList.contains("modal-backdrop")) closeModals();
  });

  function openClientModal(id){
    var c = id ? clients[id] : null;
    $("#clientModalTitle").textContent = c ? "Edit Client" : "New Client";
    $("#clientId").value = id || "";
    $("#cName").value = c ? c.name : "";
    $("#cPhone").value = c ? (c.phone||"") : "";
    $("#cEmail").value = c ? (c.email||"") : "";
    $("#cContactName").value = c ? (c.contactName||"") : "";
    $("#cContactTitle").value = c ? (c.contactTitle||"") : "";
    $("#cGstin").value = c ? (c.gstin||"") : "";
    $("#cAddress").value = c ? (c.address||"") : "";
    $("#cState").value = c ? (c.state||"Delhi") : "Delhi";
    $("#cNotes").value = c ? (c.notes||"") : "";
    openModal("clientModalBackdrop");
  }

  function populateClientSelect(sel, selected){
    var opts = Object.keys(clients)
      .sort(function(a,b){ return clients[a].name.localeCompare(clients[b].name); })
      .map(function(id){ return '<option value="'+id+'">'+esc(clients[id].name)+'</option>'; }).join("");
    sel.innerHTML = opts || '<option value="">No clients yet</option>';
    if(selected) sel.value = selected;
  }

  function toggleVendorFields(){
    var on = $("#pOutsourced").checked;
    $("#vendorFields").classList.toggle("open", on);
  }

  function openProjectModal(id, presetClientId){
    var p = id ? projects[id] : null;
    $("#projectModalTitle").textContent = p ? "Edit Project / Service" : "New Project / Service";
    $("#projectId").value = id || "";
    populateClientSelect($("#pClientId"), p ? p.clientId : presetClientId);
    $("#pTitle").value = p ? p.title : "";
    $("#pDescription").value = p ? (p.description||"") : "";
    $("#pTotal").value = p ? p.totalAmount : "";
    $("#pGstRate").value = p ? p.gstRate : 18;
    $("#pStart").value = p ? (p.startDate||todayISO()) : todayISO();
    $("#pStatus").value = p ? p.status : "active";
    $("#pOutsourced").checked = p ? !!p.isOutsourced : false;
    $("#pVendorName").value = p ? (p.vendorName||"") : "";
    $("#pVendorPhone").value = p ? (p.vendorPhone||"") : "";
    $("#pVendorCost").value = p ? (p.vendorCost||"") : "";
    $("#pVendorNotes").value = p ? (p.vendorNotes||"") : "";
    $("#pNotes").value = p ? (p.notes||"") : "";
    toggleVendorFields();
    openModal("projectModalBackdrop");
  }
  $("#pOutsourced").addEventListener("change", toggleVendorFields);

  function openPaymentModal(projectId){
    var wrap = $("#paymentProjectPickWrap");
    if(projectId){
      $("#paymentProjectId").value = projectId;
      wrap.style.display = "none";
    } else {
      $("#paymentProjectId").value = "";
      wrap.style.display = "";
      var sel = $("#paymentProjectSelect");
      var opts = Object.keys(projects).map(function(id){
        var p = projects[id], client = clients[p.clientId];
        return '<option value="'+id+'">'+esc(client?client.name:"")+' — '+esc(p.title)+'</option>';
      }).join("");
      sel.innerHTML = opts || '<option value="">No projects yet</option>';
    }
    $("#pAmount").value = "";
    $("#pDate").value = todayISO();
    $("#pMonth").value = todayISO().slice(0,7);
    $("#pMode").value = "Bank Transfer";
    $("#pNote").value = "";
    openModal("paymentModalBackdrop");
  }

  function openVendorPaymentModal(projectId){
    $("#vpProjectId").value = projectId;
    $("#vpAmount").value = "";
    $("#vpDate").value = todayISO();
    $("#vpMode").value = "Bank Transfer";
    $("#vpNote").value = "";
    openModal("vendorPaymentModalBackdrop");
  }

  function addItemRow(prefill){
    itemRowCount++;
    var wrap = document.createElement("div");
    wrap.className = "item-row";
    wrap.dataset.row = itemRowCount;
    wrap.innerHTML =
      '<div class="field" style="margin:0;"><label>Description of Service</label><input class="it-desc" value="'+esc(prefill&&prefill.description||"")+'" placeholder="e.g. Website Redesign, SEO & Social Media Reels"></div>'+
      '<div class="field" style="margin:0;"><label>SAC/HSN Code</label><input class="it-hsn" value="'+esc(prefill&&prefill.hsn||"998314")+'"></div>'+
      '<div class="field" style="margin:0;"><label>Amount (₹)</label><input class="it-amount" type="number" value="'+(prefill?prefill.amount:"")+'"></div>'+
      '<button type="button" class="rm" title="Remove">×</button>';
    wrap.querySelector(".rm").addEventListener("click", function(){ wrap.remove(); });
    $("#itemRows").appendChild(wrap);
  }

  function populateProjectSelectForInvoice(clientId, selectedProjectId){
    var sel = $("#iProject");
    var list = clientId ? projectsForClient(clientId) : [];
    var opts = '<option value="">— Custom / no project —</option>' +
      list.map(function(p){ return '<option value="'+p.id+'">'+esc(p.title)+' ('+fmtMoney(p.totalAmount)+')</option>'; }).join("");
    sel.innerHTML = opts;
    if(selectedProjectId) sel.value = selectedProjectId;
  }

  function fillItemsFromProject(projectId){
    var p = projects[projectId];
    $("#itemRows").innerHTML = ""; itemRowCount = 0;
    if(p){
      $("#iGstRate").value = p.gstRate || 18;
      addItemRow({description: p.title, amount: p.totalAmount||""});
    } else {
      addItemRow(null);
    }
  }

  function toggleImportFields(){
    var on = $("#iIsImport").checked;
    $("#iNumberField").style.display = on ? "" : "none";
    $("#invoiceModalTitle").textContent = on ? "Log an Already-Issued Invoice" : "New Invoice";
  }

  function openInvoiceModal(clientId, projectId, type){
    populateClientSelect($("#iClient"), clientId);
    var effectiveClientId = clientId || $("#iClient").value;
    populateProjectSelectForInvoice(effectiveClientId, projectId);
    $("#iType").value = type || "proforma";
    $("#iDate").value = todayISO();
    $("#iDue").value = "";
    $("#iAdvancePercent").value = "";
    $("#iIsImport").checked = false;
    $("#iNumber").value = "";
    toggleImportFields();
    fillItemsFromProject(projectId || null);
    updatePlaceOfSupply();
    $("#iClient").onchange = function(){
      populateProjectSelectForInvoice($("#iClient").value, null);
      fillItemsFromProject(null);
      updatePlaceOfSupply();
    };
    $("#iProject").onchange = function(){ fillItemsFromProject($("#iProject").value || null); };
    $("#iIsImport").onchange = toggleImportFields;
    openModal("invoiceModalBackdrop");
  }
  function updatePlaceOfSupply(){
    var cid = $("#iClient").value;
    $("#iPlace").value = (cid && clients[cid]) ? clients[cid].state : "";
  }

  // ---------------- Actions ----------------
  document.addEventListener("click", function(e){
    var t = e.target.closest("[data-action]");
    // Buttons with data-action take priority even when nested inside a
    // clickable card that also has data-open-project/-client (e.g. the
    // "Edit" / "+ Payment" buttons inside a project card).
    if(!t){
      var openClient = e.target.closest("[data-open-client]");
      var openProject = e.target.closest("[data-open-project]");
      var openInvoice = e.target.closest("[data-open-invoice]");
      var openReceipt = e.target.closest("[data-open-receipt]");
      if(openReceipt){ renderReceiptPreview(openReceipt.getAttribute("data-open-receipt")); return; }
      if(openClient){ renderClientDetail(openClient.getAttribute("data-open-client")); return; }
      if(openProject){ renderProjectDetail(openProject.getAttribute("data-open-project")); return; }
      if(openInvoice){ renderInvoicePreview(openInvoice.getAttribute("data-open-invoice")); return; }
      return;
    }
    var action = t.getAttribute("data-action");
    if(action==="new-client") openClientModal(null);
    else if(action==="edit-client") openClientModal(t.getAttribute("data-id"));
    else if(action==="close-modal") closeModals();
    else if(action==="save-client") saveClient();
    else if(action==="new-project") openProjectModal(null, t.getAttribute("data-client-id"));
    else if(action==="edit-project") openProjectModal(t.getAttribute("data-id"));
    else if(action==="save-project") saveProject();
    else if(action==="record-payment") openPaymentModal(t.getAttribute("data-project-id"));
    else if(action==="save-payment") savePayment();
    else if(action==="record-vendor-payment") openVendorPaymentModal(t.getAttribute("data-project-id"));
    else if(action==="save-vendor-payment") saveVendorPayment();
    else if(action==="invoice-for-client") openInvoiceModal(t.getAttribute("data-id"), null);
    else if(action==="invoice-for-project") openInvoiceModal(t.getAttribute("data-client-id"), t.getAttribute("data-project-id"), t.getAttribute("data-invoice-type"));
    else if(action==="new-invoice") openInvoiceModal(null, null);
    else if(action==="new-receipt") openReceiptModal(null, null);
    else if(action==="save-receipt") saveReceipt();
    else if(action==="receipt-for-payment") receiptForPayment(t.getAttribute("data-payment-id"));
    else if(action==="delete-receipt") deleteReceipt();
    else if(action==="go-receipts") showView("receipts");
    else if(action==="new-cash-entry") openCashEntryModal();
    else if(action==="edit-cash-entry") openCashEntryModal(t.getAttribute("data-id"));
    else if(action==="save-cash-entry") saveCashEntry();
    else if(action==="delete-cash-entry") deleteCashEntry(t.getAttribute("data-id"));
    else if(action==="delete-payment-row") deleteRowPayment("api/payments.php", t.getAttribute("data-id"), "Delete this client payment? The project's Received/Pending will change.");
    else if(action==="delete-vendor-row") deleteRowPayment("api/vendor_payments.php", t.getAttribute("data-id"), "Delete this vendor payment?");
    else if(action==="cashflow-for") goCashflowFor(t.getAttribute("data-scope"));
    else if(action==="add-item") addItemRow();
    else if(action==="save-invoice") saveInvoice();
    else if(action==="save-settings") saveSettings();
    else if(action==="go-clients") showView("clients");
    else if(action==="go-invoices") showView("invoices");
    else if(action==="go-back-to-client"){ if(currentClientId) renderClientDetail(currentClientId); else showView("clients"); }
    else if(action==="print-doc") window.print();
  });

  // ---------------- API layer ----------------
  function api(path, opts){
    opts = opts || {};
    var headers = Object.assign({}, opts.headers||{});
    if(opts.method === "POST"){
      headers["Content-Type"] = "application/json";
      headers["X-CSRF-Token"] = window.__CSRF__ || "";
    }
    return fetch(path, Object.assign({credentials:"same-origin"}, opts, {headers: headers}))
      .then(function(res){
        if(res.status === 401){ window.location.href = "login.php"; return new Promise(function(){}); }
        return res.json().catch(function(){ return {}; }).then(function(data){
          if(!res.ok){ throw new Error((data && data.message) || ("Request failed (" + res.status + ")")); }
          return data;
        });
      });
  }

  function mapClientRow(r){
    return {
      name: r.name, phone: r.phone, email: r.email, contactName: r.contact_name, contactTitle: r.contact_title,
      gstin: r.gstin, address: r.address, state: r.state, notes: r.notes, createdAt: r.created_at
    };
  }
  function mapProjectRow(r){
    return {
      clientId: String(r.client_id), title: r.title, description: r.description,
      totalAmount: Number(r.total_amount)||0, gstRate: Number(r.gst_rate)||18,
      startDate: r.start_date, status: r.status,
      isOutsourced: !!r.is_outsourced, vendorName: r.vendor_name, vendorPhone: r.vendor_phone,
      vendorCost: Number(r.vendor_cost)||0, vendorNotes: r.vendor_notes,
      notes: r.notes, createdAt: r.created_at
    };
  }
  function mapInvoiceRow(r){
    return {
      clientId: String(r.client_id), projectId: r.project_id!=null? String(r.project_id): null,
      clientName: r.client_name, projectTitle: r.project_title, type: r.type, number: r.number,
      date: r.invoice_date, dueDate: r.due_date, validTill: r.valid_till, items: r.items,
      subtotal: r.subtotal, gstRate: r.gst_rate, cgst: r.cgst, sgst: r.sgst, igst: r.igst, total: r.total,
      advancePercent: r.advance_percent, advanceAmount: r.advance_amount, balanceAmount: r.balance_amount,
      notes: r.notes, placeOfSupply: r.place_of_supply, isImported: !!r.is_imported
    };
  }
  function mapReceiptRow(r){
    return {
      id: String(r.id), clientId: String(r.client_id), projectId: r.project_id!=null ? String(r.project_id) : null,
      paymentId: r.payment_id!=null ? String(r.payment_id) : null,
      clientName: r.client_name, projectTitle: r.project_title, number: r.number, date: r.receipt_date,
      amount: Number(r.amount)||0, mode: r.mode, reference: r.reference, description: r.description, notes: r.notes
    };
  }
  function mapCashEntryRow(r){
    return { id: r.id, clientId: r.client_id != null ? String(r.client_id) : null, projectId: r.project_id != null ? String(r.project_id) : null, projectTitle: r.project_title || "", clientName: r.client_name || "", entryType: r.entry_type, title: r.title, category: r.category,
      amount: Number(r.amount)||0, date: r.entry_date, month: r.month,
      planStatus: r.plan_status, note: r.note };
  }
  function mapSettingsRow(r){
    return {
      legalName: r.legal_name, tagline: r.tagline, ownerName: r.owner_name, gstin: r.gstin, pan: r.pan, address: r.address, state: r.state,
      email: r.email, phone: r.phone, website: r.website,
      bank: { accountName: r.bank_account_name, accountNumber: r.bank_account_number, ifsc: r.bank_ifsc, bankName: r.bank_name, branch: r.bank_branch },
      proformaValidityDays: r.proforma_validity_days,
      taxPrefix: r.tax_prefix, taxCounter: r.tax_counter, proformaPrefix: r.proforma_prefix, proformaCounter: r.proforma_counter,
      receiptPrefix: r.receipt_prefix || "RC", receiptCounter: r.receipt_counter || 1
    };
  }

  function loadAll(){
    return Promise.all([
      api("api/clients.php"),
      api("api/projects.php"),
      api("api/payments.php"),
      api("api/vendor_payments.php"),
      api("api/invoices.php"),
      api("api/settings.php"),
      api("api/cash_entries.php"),
      // Receipts load separately so a database that hasn't had the receipts
      // migration yet shows a message there instead of breaking the whole app.
      api("api/receipts.php").catch(function(err){ return { receipts: [], __error: err.message }; })
    ]).then(function(results){
      var clientsRes = results[0], projectsRes = results[1], paymentsRes = results[2],
          vendorPaymentsRes = results[3], invoicesRes = results[4], settingsRes = results[5], cashEntriesRes = results[6], receiptsRes = results[7];

      clients = {};
      (clientsRes.clients||[]).forEach(function(r){ clients[String(r.id)] = mapClientRow(r); });

      projects = {};
      (projectsRes.projects||[]).forEach(function(r){ projects[String(r.id)] = mapProjectRow(r); });

      projectPayments = {};
      (paymentsRes.payments||[]).forEach(function(p){
        var pid = String(p.project_id);
        if(!projectPayments[pid]) projectPayments[pid] = [];
        projectPayments[pid].push({ id: String(p.id), amount: Number(p.amount)||0, date: p.payment_date, month: p.month, mode: p.mode, note: p.note });
      });

      vendorPayments = {};
      (vendorPaymentsRes.vendor_payments||[]).forEach(function(v){
        var pid = String(v.project_id);
        if(!vendorPayments[pid]) vendorPayments[pid] = [];
        vendorPayments[pid].push({ id: String(v.id), amount: Number(v.amount)||0, date: v.payment_date, mode: v.mode, note: v.note });
      });

      invoices = {};
      (invoicesRes.invoices||[]).forEach(function(r){ invoices[String(r.id)] = mapInvoiceRow(r); });

      settings = settingsRes.settings ? mapSettingsRow(settingsRes.settings) : BUSINESS_DEFAULT;
      cashEntries = (cashEntriesRes.entries||[]).map(mapCashEntryRow);

      receiptsError = receiptsRes.__error || "";
      receipts = {}; receiptsByPayment = {};
      (receiptsRes.receipts||[]).forEach(function(r){
        receipts[String(r.id)] = mapReceiptRow(r);
        if(r.payment_id != null) receiptsByPayment[String(r.payment_id)] = String(r.id);
      });
    });
  }

  function refreshAndRender(){
    return loadAll().then(function(){
      renderAll();
      if($('.view[data-view="settings"]').classList.contains("active")) renderSettings();
      if($('.view[data-view="letterhead"]').classList.contains("active")) renderLetterhead();
    });
  }

  function saveClient(){
    var id = $("#clientId").value;
    var name = $("#cName").value.trim();
    if(!name){ toast("Client name is required"); return; }
    var payload = {
      op: id ? "update" : "create",
      id: id ? Number(id) : undefined,
      name: name,
      phone: $("#cPhone").value.trim(),
      email: $("#cEmail").value.trim(),
      contact_name: $("#cContactName").value.trim(),
      contact_title: $("#cContactTitle").value.trim(),
      gstin: $("#cGstin").value.trim(),
      address: $("#cAddress").value.trim(),
      state: $("#cState").value,
      notes: $("#cNotes").value.trim()
    };
    api("api/clients.php", {method:"POST", body: JSON.stringify(payload)})
      .then(function(){ toast(id?"Client updated":"Client added"); closeModals(); return refreshAndRender(); })
      .catch(function(err){ toast("Couldn't save: "+err.message); });
  }

  function saveProject(){
    var id = $("#projectId").value;
    var clientId = $("#pClientId").value;
    var title = $("#pTitle").value.trim();
    if(!clientId){ toast("Pick a client first"); return; }
    if(!title){ toast("Project title is required"); return; }
    var payload = {
      op: id ? "update" : "create",
      id: id ? Number(id) : undefined,
      client_id: Number(clientId),
      title: title,
      description: $("#pDescription").value.trim(),
      total_amount: Number($("#pTotal").value)||0,
      gst_rate: Number($("#pGstRate").value)||18,
      start_date: $("#pStart").value || todayISO(),
      status: $("#pStatus").value,
      is_outsourced: $("#pOutsourced").checked,
      vendor_name: $("#pVendorName").value.trim(),
      vendor_phone: $("#pVendorPhone").value.trim(),
      vendor_cost: Number($("#pVendorCost").value)||0,
      vendor_notes: $("#pVendorNotes").value.trim(),
      notes: $("#pNotes").value.trim()
    };
    api("api/projects.php", {method:"POST", body: JSON.stringify(payload)})
      .then(function(){ toast(id?"Project updated":"Project added"); closeModals(); return refreshAndRender(); })
      .catch(function(err){ toast("Couldn't save: "+err.message); });
  }

  function savePayment(){
    var projectId = $("#paymentProjectId").value || $("#paymentProjectSelect").value;
    if(!projectId){ toast("Pick a project first"); return; }
    var amount = Number($("#pAmount").value);
    if(!amount || amount<=0){ toast("Enter a valid amount"); return; }
    var payload = { op:"create", project_id: Number(projectId), amount: amount, date: $("#pDate").value||todayISO(), month: $("#pMonth").value, mode: $("#pMode").value, note: $("#pNote").value.trim() };
    api("api/payments.php", {method:"POST", body: JSON.stringify(payload)})
      .then(function(){ toast("Payment recorded"); closeModals(); return refreshAndRender(); })
      .catch(function(err){ toast("Couldn't save: "+err.message); });
  }

  function saveVendorPayment(){
    var projectId = $("#vpProjectId").value;
    var amount = Number($("#vpAmount").value);
    if(!amount || amount<=0){ toast("Enter a valid amount"); return; }
    var payload = { op:"create", project_id: Number(projectId), amount: amount, date: $("#vpDate").value||todayISO(), mode: $("#vpMode").value, note: $("#vpNote").value.trim() };
    api("api/vendor_payments.php", {method:"POST", body: JSON.stringify(payload)})
      .then(function(){ toast("Vendor payment recorded"); closeModals(); return refreshAndRender(); })
      .catch(function(err){ toast("Couldn't save: "+err.message); });
  }

  function saveCashEntry(){
    var id = $("#ceId").value;
    var title = $("#ceTitle").value.trim();
    var amount = Number($("#ceAmount").value);
    if(!title){ toast("Entry title is required"); return; }
    if(!amount || amount <= 0){ toast("Enter a valid amount"); return; }
    var payload = {
      op: id ? "update" : "create", id: id ? Number(id) : undefined, entry_type: $("#ceType").value, title: title, amount: amount,
      client_id: $("#ceClientId").value ? Number($("#ceClientId").value) : null,
      project_id: $("#ceProjectId").value ? Number($("#ceProjectId").value) : null, mode: $("#ceMode").value,
      entry_date: $("#ceDate").value || todayISO(), category: $("#ceCategory").value.trim(),
      plan_status: $("#cePlanStatus").value, note: $("#ceNote").value.trim()
    };
    api("api/cash_entries.php", {method:"POST", body: JSON.stringify(payload)})
      .then(function(res){
        toast(res && res.as_payment ? "Recorded as a project payment — project balance updated" : (id ? "Cash-flow entry updated" : "Cash-flow entry saved"));
        closeModals(); return refreshAndRender();
      })
      .catch(function(err){ toast("Couldn't save: "+err.message); });
  }

  function deleteRowPayment(url, id, question){
    if(!id || !window.confirm(question)) return;
    api(url, {method:"POST", body: JSON.stringify({op:"delete", id:Number(id)})})
      .then(function(){ toast("Payment deleted"); return refreshAndRender(); })
      .catch(function(err){ toast("Couldn't delete: "+err.message); });
  }

  function deleteCashEntry(id){
    if(!id || !window.confirm("Delete this cash-flow entry?")) return;
    api("api/cash_entries.php", {method:"POST", body: JSON.stringify({op:"delete", id:Number(id)})})
      .then(function(){ toast("Entry deleted"); return refreshAndRender(); })
      .catch(function(err){ toast("Couldn't delete: "+err.message); });
  }

  function saveInvoice(){
    var clientId = $("#iClient").value;
    if(!clientId || !clients[clientId]){ toast("Pick a client first"); return; }
    var projectId = $("#iProject").value || null;
    var type = $("#iType").value;
    var isImport = $("#iIsImport").checked;
    var rows = $all("#itemRows .item-row");
    var items = rows.map(function(r){
      var amount = Number(r.querySelector(".it-amount").value)||0;
      return { description: r.querySelector(".it-desc").value.trim(), hsn: r.querySelector(".it-hsn").value.trim(), qty:1, rate:amount };
    }).filter(function(it){ return it.description; });
    if(!items.length){ toast("Add at least one line item"); return; }

    var payload = {
      op: isImport ? "import" : "create",
      client_id: Number(clientId), project_id: projectId?Number(projectId):null, type: type,
      date: $("#iDate").value||todayISO(), due_date: $("#iDue").value||"",
      items: items, gst_rate: Number($("#iGstRate").value)||0,
      advance_percent: Number($("#iAdvancePercent").value)||0,
      notes: $("#iNotes").value.trim()
    };
    if(isImport){
      var number = $("#iNumber").value.trim();
      if(!number){ toast("Enter the invoice number exactly as it was issued"); return; }
      payload.number = number;
    }
    api("api/invoices.php", {method:"POST", body: JSON.stringify(payload)})
      .then(function(result){
        closeModals(); toast("Invoice "+result.number+(isImport?" logged":" generated"));
        return refreshAndRender().then(function(){ renderInvoicePreview(String(result.id)); });
      })
      .catch(function(err){ toast("Couldn't save: "+err.message); });
  }

  function saveSettings(){
    var payload = {
      legal_name: $("#sName").value.trim(), tagline: $("#sTagline").value.trim(), owner_name: $("#sOwnerName").value.trim(),
      gstin: $("#sGstin").value.trim(), pan: $("#sPan").value.trim(),
      address: $("#sAddress").value.trim(), email: $("#sEmail").value.trim(), phone: $("#sPhone").value.trim(),
      website: $("#sWebsite").value.trim(),
      bank_account_name: $("#sBankName").value.trim(), bank_account_number: $("#sBankAcc").value.trim(),
      bank_ifsc: $("#sBankIfsc").value.trim(), bank_name: $("#sBankBranch").value.trim(), bank_branch: "",
      proforma_validity_days: Number($("#sValidityDays").value)||7,
      tax_prefix: $("#sTaxPrefix").value.trim()||"NW", tax_counter: Number($("#sTaxCounter").value)||1,
      proforma_prefix: $("#sProPrefix").value.trim()||"PF", proforma_counter: Number($("#sProCounter").value)||1,
      receipt_prefix: $("#sRecPrefix").value.trim()||"RC", receipt_counter: Number($("#sRecCounter").value)||1,
      state: $("#sState").value || "Delhi"
    };
    api("api/settings.php", {method:"POST", body: JSON.stringify(payload)})
      .then(function(){ toast("Settings saved"); return refreshAndRender(); })
      .catch(function(err){ toast("Couldn't save: "+err.message); });
  }



  // ---------------- My Profile ----------------
  function renderProfile(){
    renderPasskeys();
    api("api/profile.php").then(function(d){
      var p = d.profile || {};
      $("#pfName").value = p.display_name || ""; $("#pfUser").value = p.username || ""; $("#pfEmail").value = p.email || "";
      $("#pfMeta").textContent = "Account created " + String(p.created_at||"").slice(0,10) + (p.last_login_at ? " · last sign-in " + String(p.last_login_at).slice(0,16).replace("T"," ") : "");
    }).catch(function(err){ toast("Couldn't load profile: "+err.message); });
  }
  (function(){
    var save = $("#pfSave"), pw = $("#pwSave");
    if(save) save.addEventListener("click", function(){
      save.disabled = true;
      api("api/profile.php", {method:"POST", body: JSON.stringify({op:"update_profile", display_name:$("#pfName").value, username:$("#pfUser").value, email:$("#pfEmail").value})})
        .then(function(d){
          var p = d.profile||{}; window.__ADMIN_USER__ = p.display_name || p.username || ""; renderFoot();
          toast("Profile saved");
        }).catch(function(e){ toast(e.message); }).then(function(){ save.disabled = false; });
    });
    if(pw) pw.addEventListener("click", function(){
      var n = $("#pwNew").value;
      if(n !== $("#pwNew2").value){ toast("New passwords don't match"); return; }
      pw.disabled = true;
      api("api/profile.php", {method:"POST", body: JSON.stringify({op:"change_password", current:$("#pwCur").value, "new":n})})
        .then(function(){ toast("Password updated"); ["#pwCur","#pwNew","#pwNew2"].forEach(function(s){ $(s).value = ""; });
          return fetch("api/me.php",{credentials:"same-origin"}).then(function(r){return r.json();}).then(function(m){ if(m && m.csrf) window.__CSRF__ = m.csrf; }); })
        .catch(function(e){ toast(e.message); }).then(function(){ pw.disabled = false; });
    });
  })();

  // ---------------- Biometric login (passkeys) ----------------
  function b2u(buf){ var s=""; new Uint8Array(buf).forEach(function(c){ s+=String.fromCharCode(c); }); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
  function u2b(str){ str=str.replace(/-/g,"+").replace(/_/g,"/"); while(str.length%4) str+="="; var bin=atob(str), a=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return a.buffer; }
  function guessDeviceName(){
    var ua = navigator.userAgent||"";
    if(/iPhone/.test(ua)) return "iPhone"; if(/iPad/.test(ua)) return "iPad";
    if(/Android/.test(ua)) return "Android phone"; if(/Windows/.test(ua)) return "Windows PC";
    if(/Mac/.test(ua)) return "Mac"; return "This device";
  }
  function renderPasskeys(){
    var list = $("#passkeyList"), add = $("#passkeyAdd");
    if(!list || !add) return;
    var supported = !!(window.PublicKeyCredential && navigator.credentials);
    add.style.display = supported ? "" : "none";
    if(!supported){ list.innerHTML = '<div class="hint">This browser doesn\'t support biometric login.</div>'; return; }
    api("api/passkey.php").then(function(d){
      var rows = d.passkeys || [];
      list.innerHTML = rows.length ? rows.map(function(r){
        return '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px dashed var(--line);">'+
          '<div><b>'+esc(r.label)+'</b><div class="hint">Added '+esc(String(r.created_at||"").slice(0,10))+(r.last_used_at? ' · last used '+esc(String(r.last_used_at).slice(0,10)) : ' · not used yet')+'</div></div>'+
          '<button class="btn btn-ghost btn-sm" data-passkey-del="'+r.id+'">Remove</button></div>';
      }).join("") : '<div class="hint">No device enabled yet.</div>';
    }).catch(function(err){ list.innerHTML = '<div class="hint" style="color:var(--danger)">'+esc(err.message)+'</div>'; add.style.display = "none"; });
  }
  function enablePasskey(){
    var btn = $("#passkeyAdd"); btn.disabled = true;
    api("api/passkey.php", {method:"POST", body: JSON.stringify({op:"register_options"})}).then(function(o){
      var pk = o.publicKey;
      pk.challenge = u2b(pk.challenge); pk.user.id = u2b(pk.user.id);
      (pk.excludeCredentials||[]).forEach(function(c){ c.id = u2b(c.id); });
      return navigator.credentials.create({publicKey: pk});
    }).then(function(c){
      return api("api/passkey.php", {method:"POST", body: JSON.stringify({op:"register_verify", label: guessDeviceName(), credential:{ id:c.id, response:{
        clientDataJSON:b2u(c.response.clientDataJSON), attestationObject:b2u(c.response.attestationObject) } }})});
    }).then(function(){ toast("Biometric login enabled on this device"); renderPasskeys(); })
    .catch(function(e){
      if(e && (e.name==="NotAllowedError" || e.name==="AbortError")) toast("Cancelled");
      else if(e && e.name==="InvalidStateError") toast("This device is already enabled");
      else toast("Couldn't enable: "+((e&&e.message)||"unknown error"));
    }).then(function(){ btn.disabled = false; });
  }
  (function(){
    var add = $("#passkeyAdd"); if(add) add.addEventListener("click", enablePasskey);
    var list = $("#passkeyList");
    if(list) list.addEventListener("click", function(e){
      var b = e.target.closest("[data-passkey-del]"); if(!b) return;
      if(!confirm("Remove biometric login for this device?")) return;
      api("api/passkey.php", {method:"POST", body: JSON.stringify({op:"delete", id: Number(b.getAttribute("data-passkey-del"))})})
        .then(function(){ toast("Removed"); renderPasskeys(); }).catch(function(err){ toast(err.message); });
    });
  })();

  // ---------------- Sidebar footer (who's logged in) ----------------
  function renderFoot(){
    var el = $("#sidebarFoot");
    if(!el) return;
    var user = window.__ADMIN_USER__ || "";
    el.innerHTML = 'Signed in as <a href="#profile" data-goto="profile"><b>'+esc(user)+'</b></a><br><a href="logout.php">Log out</a>';
    var link = el.querySelector("[data-goto]");
    if(link) link.addEventListener("click", function(e){ e.preventDefault(); navTo("profile"); });
  }

  // "Save as PDF" names the file after the page title: use the document number.
  (function(){
    var saved = null;
    window.addEventListener("beforeprint", function(){
      var rc = currentReceiptId && receipts[currentReceiptId];
      var rcView = $('.view[data-view="receipt-preview"]');
      if(rc && rcView && rcView.classList.contains("active")){ saved = document.title; document.title = "Receipt " + String(rc.number).replace(/[\\/]/g, "-"); }
    });
    window.addEventListener("afterprint", function(){ if(saved !== null){ document.title = saved; saved = null; } });
  })();

  // ---------------- Init ----------------
  function init(){
    renderFoot();
    $("#cashMonth").value = currentMonthISO();
    $("#cashMonth").addEventListener("change", renderCashflow);
    $("#cashCategoryFilter").addEventListener("change", renderCashflow);
    $("#cashScope").addEventListener("change", renderCashflow);
    $("#cashAllMonths").addEventListener("change", renderCashflow);
    loadAll().then(function(){
      renderAll();
      var h = location.hash.slice(1);
      if(NAV_VIEWS.indexOf(h) >= 0 && h !== "dashboard") navTo(h, true);
    }).catch(function(err){
      toast("Couldn't load data: " + err.message);
    });
  }
  init();

})();
