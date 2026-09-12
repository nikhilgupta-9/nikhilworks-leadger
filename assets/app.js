(function(){
  "use strict";

  var LOGO_FULL = "assets/img/logo-full.png";

  // ---------------- State ----------------
  var clients = {};          // clientId(string) -> data
  var projects = {};         // projectId(string) -> data (includes client_id)
  var projectPayments = {};  // projectId(string) -> [payments] (client -> you)
  var vendorPayments = {};   // projectId(string) -> [vendor payments] (you -> vendor)
  var invoices = {};         // id(string) -> data
  var settings = null;
  var currentClientId = null;
  var currentProjectId = null;
  var itemRowCount = 0;

  var BUSINESS_DEFAULT = {
    legalName: "NikhilWorks", gstin: "", pan: "", address: "", state: "Delhi",
    email: "", phone: "", website: "",
    bank: { accountName: "", accountNumber: "", ifsc: "", bankName: "", branch: "" },
    taxPrefix: "NW", taxCounter: 1, proformaPrefix: "PF", proformaCounter: 1
  };

  // ---------------- Utilities ----------------
  function $(sel, root){ return (root||document).querySelector(sel); }
  function $all(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function todayISO(){ return new Date().toISOString().slice(0,10); }
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
    $all("#navlist button").forEach(function(b){ b.classList.toggle("active", b.getAttribute("data-view")===name); });
    window.scrollTo(0,0);
  }
  $all("#navlist button").forEach(function(b){
    b.addEventListener("click", function(){
      var v = b.getAttribute("data-view");
      showView(v);
      if(v==="letterhead") renderLetterhead();
      if(v==="settings") renderSettings();
      if(v==="outsourcing") renderOutsourcing();
      if(v==="projects") renderProjectsList();
    });
  });

  // ---------------- Rendering: Dashboard ----------------
  function renderAll(){
    renderDashboard();
    renderClientsTable();
    renderInvoicesTable();
    if($('.view[data-view="projects"]').classList.contains("active")) renderProjectsList();
    if(currentProjectId && projects[currentProjectId]) renderProjectDetail(currentProjectId);
    else if(currentClientId && clients[currentClientId]) renderClientDetail(currentClientId);
    if($('.view[data-view="outsourcing"]').classList.contains("active")) renderOutsourcing();
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
          return '<div class="pay-row"><div><b class="num">'+fmtMoney(pay.amount)+'</b> <span class="muted">via '+esc(pay.mode)+(pay.month?' · '+fmtMonth(pay.month):'')+'</span>'+(pay.note?' — '+esc(pay.note):'')+'</div><div class="muted">'+fmtDate(pay.date)+'</div></div>';
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
    $("#invPreviewTitle").textContent = (isTax?"Tax Invoice ":"Proforma Invoice ") + inv.number;

    var itemsHTML = inv.items.map(function(it){
      return '<tr><td>'+esc(it.description)+(it.hsn?' <span style="color:#7c908c;">('+esc(it.hsn)+')</span>':'')+'</td>'+
        '<td class="num">'+it.qty+'</td><td class="num">'+fmtMoney(it.rate)+'</td><td class="num">'+fmtMoney(it.amount)+'</td></tr>';
    }).join("");

    var taxRowsHTML = "";
    if(isTax){
      if(sameState){
        taxRowsHTML = '<tr><td>CGST ('+(inv.gstRate/2)+'%)</td><td class="num">'+fmtMoney(inv.cgst)+'</td></tr>'+
                      '<tr><td>SGST ('+(inv.gstRate/2)+'%)</td><td class="num">'+fmtMoney(inv.sgst)+'</td></tr>';
      } else {
        taxRowsHTML = '<tr><td>IGST ('+inv.gstRate+'%)</td><td class="num">'+fmtMoney(inv.igst)+'</td></tr>';
      }
    }

    var html = ''+
      '<div class="doc-head">'+
        '<div><img src="'+LOGO_FULL+'" alt="NikhilWorks" class="doc-logo"><div class="addr">'+esc(s.legalName)+'<br>'+esc(s.address)+'<br>'+esc(s.email)+' · '+esc(s.phone)+'</div></div>'+
        '<div class="doc-title"><h2>'+(isTax?"TAX INVOICE":"PROFORMA INVOICE")+'</h2>'+
          '<div class="meta">'+
            '<div><span>No.</span><b>'+esc(inv.number)+'</b></div>'+
            '<div><span>Date</span><b>'+fmtDate(inv.date)+'</b></div>'+
            (inv.dueDate?'<div><span>Due</span><b>'+fmtDate(inv.dueDate)+'</b></div>':'')+
            (isTax?'<div><span>GSTIN</span><b>'+esc(s.gstin)+'</b></div>':'')+
          '</div>'+
        '</div>'+
      '</div>'+
      (isTax?'':'<div style="text-align:right; font-size:10.5px; color:#b3791d; font-weight:700; margin:-10px 0 14px;">This is a Proforma Invoice — not a demand for payment and not valid for GST input credit.</div>')+
      '<div class="bill-to">'+
        '<div class="block"><h4>Billed To</h4><div class="name">'+esc(client.name||inv.clientName||"—")+'</div><div style="color:#3d5450;">'+esc(client.email||"")+(client.phone?' · '+esc(client.phone):'')+'<br>'+esc(client.state||"")+(client.gstin?'<br>GSTIN: '+esc(client.gstin):'')+'</div></div>'+
        '<div class="block" style="text-align:right;"><h4>Place of Supply</h4><div>'+esc(client.state||inv.placeOfSupply||"—")+'</div>'+(inv.projectTitle?'<div class="muted" style="margin-top:6px; font-size:11px;">'+esc(inv.projectTitle)+'</div>':'')+'</div>'+
      '</div>'+
      '<table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>'+itemsHTML+'</tbody></table>'+
      '<div class="totals"><table>'+
        '<tr><td>Subtotal</td><td class="num">'+fmtMoney(inv.subtotal)+'</td></tr>'+
        taxRowsHTML+
        '<tr class="grand"><td>Total'+(isTax?' Due':' Amount')+'</td><td class="num">'+fmtMoney(inv.total)+'</td></tr>'+
      '</table></div>'+
      '<div class="words">Amount in words: <b>Rupees '+numberToWordsIndian(inv.total)+' Only</b></div>'+
      '<div class="lower">'+
        '<div class="bank-box"><h4>Payment Details</h4>'+
          'A/c Name: '+esc(s.bank.accountName)+'<br>A/c No: '+esc(s.bank.accountNumber)+'<br>IFSC: '+esc(s.bank.ifsc)+'<br>Bank: '+esc(s.bank.bankName)+', '+esc(s.bank.branch)+
          (isTax?'<br>GSTIN: '+esc(s.gstin)+' · PAN: '+esc(s.pan):'')+
        '</div>'+
        '<div class="terms"><h4>Notes</h4>'+esc(inv.notes||"")+'</div>'+
      '</div>'+
      '<div class="sign"><div>For '+esc(s.legalName)+'</div><div class="line"></div><div>Authorised Signatory</div></div>'+
      '<div class="doc-foot">'+esc(s.legalName)+' · '+esc(s.website)+' · Generated via NikhilWorks Ledger</div>';
    $("#printArea").innerHTML = html;
    showView("invoice-preview");
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
      '<div class="field" style="margin:0;"><label>Description</label><input class="it-desc" value="'+esc(prefill&&prefill.description||"")+'" placeholder="e.g. Website design & development"></div>'+
      '<div class="field" style="margin:0;"><label>HSN/SAC</label><input class="it-hsn" value="'+esc(prefill&&prefill.hsn||"998314")+'"></div>'+
      '<div class="field" style="margin:0;"><label>Qty</label><input class="it-qty" type="number" value="'+(prefill?prefill.qty:1)+'"></div>'+
      '<div class="field" style="margin:0;"><label>Rate (₹)</label><input class="it-rate" type="number" value="'+(prefill?prefill.rate:"")+'"></div>'+
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
      addItemRow({description: p.title, qty:1, rate: p.totalAmount||""});
    } else {
      addItemRow(null);
    }
  }

  function openInvoiceModal(clientId, projectId, type){
    populateClientSelect($("#iClient"), clientId);
    var effectiveClientId = clientId || $("#iClient").value;
    populateProjectSelectForInvoice(effectiveClientId, projectId);
    $("#iType").value = type || "proforma";
    $("#iDate").value = todayISO();
    $("#iDue").value = "";
    fillItemsFromProject(projectId || null);
    updatePlaceOfSupply();
    $("#iClient").onchange = function(){
      populateProjectSelectForInvoice($("#iClient").value, null);
      fillItemsFromProject(null);
      updatePlaceOfSupply();
    };
    $("#iProject").onchange = function(){ fillItemsFromProject($("#iProject").value || null); };
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
      name: r.name, phone: r.phone, email: r.email, gstin: r.gstin, address: r.address,
      state: r.state, notes: r.notes, createdAt: r.created_at
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
      date: r.invoice_date, dueDate: r.due_date, items: r.items,
      subtotal: r.subtotal, gstRate: r.gst_rate, cgst: r.cgst, sgst: r.sgst, igst: r.igst, total: r.total,
      notes: r.notes, placeOfSupply: r.place_of_supply
    };
  }
  function mapSettingsRow(r){
    return {
      legalName: r.legal_name, gstin: r.gstin, pan: r.pan, address: r.address, state: r.state,
      email: r.email, phone: r.phone, website: r.website,
      bank: { accountName: r.bank_account_name, accountNumber: r.bank_account_number, ifsc: r.bank_ifsc, bankName: r.bank_name, branch: r.bank_branch },
      taxPrefix: r.tax_prefix, taxCounter: r.tax_counter, proformaPrefix: r.proforma_prefix, proformaCounter: r.proforma_counter
    };
  }

  function loadAll(){
    return Promise.all([
      api("api/clients.php"),
      api("api/projects.php"),
      api("api/payments.php"),
      api("api/vendor_payments.php"),
      api("api/invoices.php"),
      api("api/settings.php")
    ]).then(function(results){
      var clientsRes = results[0], projectsRes = results[1], paymentsRes = results[2],
          vendorPaymentsRes = results[3], invoicesRes = results[4], settingsRes = results[5];

      clients = {};
      (clientsRes.clients||[]).forEach(function(r){ clients[String(r.id)] = mapClientRow(r); });

      projects = {};
      (projectsRes.projects||[]).forEach(function(r){ projects[String(r.id)] = mapProjectRow(r); });

      projectPayments = {};
      (paymentsRes.payments||[]).forEach(function(p){
        var pid = String(p.project_id);
        if(!projectPayments[pid]) projectPayments[pid] = [];
        projectPayments[pid].push({ amount: Number(p.amount)||0, date: p.payment_date, month: p.month, mode: p.mode, note: p.note });
      });

      vendorPayments = {};
      (vendorPaymentsRes.vendor_payments||[]).forEach(function(v){
        var pid = String(v.project_id);
        if(!vendorPayments[pid]) vendorPayments[pid] = [];
        vendorPayments[pid].push({ amount: Number(v.amount)||0, date: v.payment_date, mode: v.mode, note: v.note });
      });

      invoices = {};
      (invoicesRes.invoices||[]).forEach(function(r){ invoices[String(r.id)] = mapInvoiceRow(r); });

      settings = settingsRes.settings ? mapSettingsRow(settingsRes.settings) : BUSINESS_DEFAULT;
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

  function saveInvoice(){
    var clientId = $("#iClient").value;
    if(!clientId || !clients[clientId]){ toast("Pick a client first"); return; }
    var projectId = $("#iProject").value || null;
    var type = $("#iType").value;
    var rows = $all("#itemRows .item-row");
    var items = rows.map(function(r){
      var qty = Number(r.querySelector(".it-qty").value)||0;
      var rate = Number(r.querySelector(".it-rate").value)||0;
      return { description: r.querySelector(".it-desc").value.trim(), hsn: r.querySelector(".it-hsn").value.trim(), qty:qty, rate:rate };
    }).filter(function(it){ return it.description; });
    if(!items.length){ toast("Add at least one line item"); return; }

    var payload = {
      op: "create", client_id: Number(clientId), project_id: projectId?Number(projectId):null, type: type,
      date: $("#iDate").value||todayISO(), due_date: $("#iDue").value||"",
      items: items, gst_rate: Number($("#iGstRate").value)||0,
      notes: $("#iNotes").value.trim()
    };
    api("api/invoices.php", {method:"POST", body: JSON.stringify(payload)})
      .then(function(result){
        closeModals(); toast("Invoice "+result.number+" generated");
        return refreshAndRender().then(function(){ renderInvoicePreview(String(result.id)); });
      })
      .catch(function(err){ toast("Couldn't generate: "+err.message); });
  }

  function saveSettings(){
    var payload = {
      legal_name: $("#sName").value.trim(), gstin: $("#sGstin").value.trim(), pan: $("#sPan").value.trim(),
      address: $("#sAddress").value.trim(), email: $("#sEmail").value.trim(), phone: $("#sPhone").value.trim(),
      website: $("#sWebsite").value.trim(),
      bank_account_name: $("#sBankName").value.trim(), bank_account_number: $("#sBankAcc").value.trim(),
      bank_ifsc: $("#sBankIfsc").value.trim(), bank_name: $("#sBankBranch").value.trim(), bank_branch: "",
      tax_prefix: $("#sTaxPrefix").value.trim()||"NW", tax_counter: Number($("#sTaxCounter").value)||1,
      proforma_prefix: $("#sProPrefix").value.trim()||"PF", proforma_counter: Number($("#sProCounter").value)||1,
      state: $("#sState").value || "Delhi"
    };
    api("api/settings.php", {method:"POST", body: JSON.stringify(payload)})
      .then(function(){ toast("Settings saved"); return refreshAndRender(); })
      .catch(function(err){ toast("Couldn't save: "+err.message); });
  }

  // ---------------- Sidebar footer (who's logged in) ----------------
  function renderFoot(){
    var el = $("#sidebarFoot");
    if(!el) return;
    var user = window.__ADMIN_USER__ || "";
    el.innerHTML = 'Signed in as <b>'+esc(user)+'</b><br><a href="logout.php">Log out</a>';
  }

  // ---------------- Init ----------------
  function init(){
    renderFoot();
    loadAll().then(function(){
      renderAll();
    }).catch(function(err){
      toast("Couldn't load data: " + err.message);
    });
  }
  init();

})();
