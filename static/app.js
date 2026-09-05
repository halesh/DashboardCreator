angular.module('dashboardApp', [])
.controller('MainCtrl', function($scope, $http, $timeout){
  $scope.fileId=null; $scope.filename=""; $scope.sheets=[]; $scope.currentSheet=null;
  $scope.cols=[]; $scope.colTypes={}; $scope.uniqueCounts={}; $scope.rowCount=0; $scope.catCount=0;
  $scope.rawData=[]; $scope.filtered=[]; $scope.charts=[]; $scope.filters=[]; $scope.globalSearch="";
  $scope.builder={title:"", type:"bar", x:"", y:"", agg:"count", sort:true};
  $scope.sortCol=null; $scope.sortDir="asc"; $scope.dragOver=false; $scope.uploading=false; $scope.error=null;
  $scope.previewInst=null;

  $scope.triggerUpload=()=> document.getElementById('fileInput').click();
  $scope.onDragOver=e=>{ e.preventDefault(); $scope.dragOver=true; $scope.$apply(); };
  $scope.onDrop=e=>{
    e.preventDefault(); $scope.dragOver=false;
    if(e.dataTransfer.files[0]) $scope.onFile(e.dataTransfer.files[0]);
    $scope.$apply();
  };

  $scope.onFile=file=>{
    if(!file) return;
    $scope.uploading=true; $scope.error=null;
    const fd=new FormData(); fd.append('file', file);
    $http.post('/api/upload', fd, {headers:{'Content-Type':undefined}, transformRequest:angular.identity})
    .then(res=>{
      $scope.fileId=res.data.file_id;
      $scope.filename=res.data.filename;
      $scope.sheets=res.data.sheets;
      $scope.uploading=false;
      if($scope.sheets.length){
        // pick largest sheet
        let best=$scope.sheets.slice().sort((a,b)=>b.rows-a.rows)[0];
        $scope.switchSheet(best.name);
      }
    }, err=>{
      $scope.uploading=false;
      $scope.error=(err.data&&err.data.error)||"Upload failed";
    });
  };

  $scope.switchSheet=name=>{
    const meta=$scope.sheets.find(s=>s.name===name);
    if(!meta) return;
    $scope.currentSheet=name;
    $scope.cols=meta.columns;
    $scope.colTypes=meta.columnTypes;
    $scope.uniqueCounts=meta.uniqueCounts;
    $scope.rowCount=meta.rows;
    $scope.catCount=Object.values($scope.colTypes).filter(v=>v==='cat').length;
    $scope.builder.x=$scope.cols[0]||"";
    $scope.builder.title=$scope.builder.x+" breakdown";
    $scope.filters=[]; $scope.globalSearch="";
    // fetch full data for this sheet
    $http.get('/api/data', {params:{file_id:$scope.fileId, sheet:name}})
    .then(res=>{
      $scope.rawData=res.data.data;
      $scope.filtered=$scope.rawData.slice();
      $timeout(()=> $scope.previewChart(), 100);
    });
    $scope.charts=[];
  };

  $scope.getUnique=col=>{
    const vals=[...new Set($scope.rawData.map(r=> (r[col]||"").toString().trim()).filter(v=>v!==""))].sort();
    return vals;
  };
  $scope.countValue=(col,val)=>{
    return $scope.rawData.filter(r=> (r[col]||"").toString().trim()===val).length;
  };

  // Aggregations for charts (uses rawData of current sheet)
  function aggregate(xCol, agg, yCol, doSort){
    let map=new Map(), yVals=new Map();
    $scope.rawData.forEach(r=>{
      let x=(r[xCol]||"").toString().trim() || "(blank)";
      if(!map.has(x)) map.set(x,0), yVals.set(x,[]);
      if(agg==="count") map.set(x, map.get(x)+1);
      else if(agg==="countDistinct"){ let y=(r[yCol]||"").toString().trim(); if(!yVals.get(x).includes(y) && y!=="") yVals.get(x).push(y); }
      else if(agg==="sum"||agg==="avg"){ let v=parseFloat((r[yCol]||"").toString().replace(/,/g,"")); if(!isNaN(v)) yVals.get(x).push(v); }
    });
    let labels, values;
    if(agg==="count"){ labels=[...map.keys()]; values=[...map.values()]; }
    else if(agg==="countDistinct"){ labels=[...yVals.keys()]; values=[...yVals.values()].map(a=>a.length); }
    else if(agg==="sum"){ labels=[...yVals.keys()]; values=[...yVals.values()].map(a=>a.reduce((s,v)=>s+v,0)); }
    else if(agg==="avg"){ labels=[...yVals.keys()]; values=[...yVals.values()].map(a=> a.length? a.reduce((s,v)=>s+v,0)/a.length :0); }
    if(doSort){ let idx=values.map((v,i)=>[v,i]).sort((a,b)=>b[0]-a[0]).map(x=>x[1]); labels=idx.map(i=>labels[i]); values=idx.map(i=>values[i]); }
    if(labels.length>20){ labels=labels.slice(0,20); values=values.slice(0,20); }
    return {labels, values};
  }

  $scope.onBuilderX=()=>{
    $scope.builder.title=$scope.builder.x+" breakdown";
    $scope.previewChart();
  };
  $scope.previewChart=()=>{
    $timeout(()=>{
      if(!$scope.cols.length || !$scope.builder.x) return;
      const res=aggregate($scope.builder.x, $scope.builder.agg, $scope.builder.y, $scope.builder.sort);
      const ctx=document.getElementById('preview').getContext('2d');
      if($scope.previewInst) $scope.previewInst.destroy();
      const colors=res.labels.map((_,i)=>'hsl('+(i*37)%360+' 75% 55%)');
      const isH=$scope.builder.type==='hbar'; const type=isH?'bar':$scope.builder.type;
      $scope.previewInst=new Chart(ctx,{
        type:type,
        data:{labels:res.labels, datasets:[{label: $scope.builder.agg==='count'?'Count': $scope.builder.agg+' ('+($scope.builder.y||$scope.builder.x)+')', data:res.values, backgroundColor: (type==='pie'||type==='doughnut')?colors: '#0f5bff', borderRadius:6}]},
        options:{indexAxis:isH?'y':'x', plugins:{legend:{display: type==='pie'||type==='doughnut', position:'bottom'}}, scales: (type==='pie'||type==='doughnut')?{}:{x:{grid:{color:'#f1f5f9'}}, y:{grid:{color:'#f1f5f9'}}}, onHover:(e,els)=>{ e.native.target.style.cursor=els.length?'pointer':'default'; }}
      });
    }, 50);
  };
  $scope.addChart=()=>{
    const title=$scope.builder.title.trim() || ($scope.builder.x+" — "+$scope.builder.agg);
    const cfg={id:"c"+Date.now(), title:title, type:$scope.builder.type, x:$scope.builder.x, y:$scope.builder.y, agg:$scope.builder.agg, sort:$scope.builder.sort, sheet:$scope.currentSheet};
    $scope.charts.push(cfg);
    $timeout(()=> $scope.renderChart(cfg), 100);
  };
  $scope.renderChart=cfg=>{
    const res=aggregate(cfg.x, cfg.agg, cfg.y, cfg.sort);
    const ctx=document.getElementById(cfg.id);
    if(!ctx) return;
    const colors=res.labels.map((_,i)=>'hsl('+(i*37)%360+' 75% 55%)');
    const isH=cfg.type==='hbar'; const type=isH?'bar':cfg.type;
    new Chart(ctx.getContext('2d'),{
      type:type,
      data:{labels:res.labels, datasets:[{label: cfg.agg==='count'?'Count': cfg.agg+' ('+(cfg.y||cfg.x)+')', data:res.values, backgroundColor: (type==='pie'||type==='doughnut')?colors: '#0f5bff', borderRadius:6}]},
      options:{
        indexAxis:isH?'y':'x',
        plugins:{legend:{display: type==='pie'||type==='doughnut', position:'bottom'}},
        scales: (type==='pie'||type==='doughnut')?{}:{x:{grid:{color:'#f1f5f9'}}, y:{grid:{color:'#f1f5f9'}}},
        onHover:(e,els)=>{ e.native.target.style.cursor=els.length?'pointer':'default'; },
        onClick:(e,els,chart)=>{
          if(!els.length) return;
          const idx=els[0].index;
          const label=chart.data.labels[idx];
          $scope.$apply(()=>{
            let f=$scope.filters.find(f=>f.col===cfg.x);
            if(!f){ f={col:cfg.x, selected:[], q:"", open:false}; $scope.filters.push(f); }
            if(f.selected.indexOf(label)===-1) f.selected.push(label);
            $scope.applyFilters();
            document.querySelector('.table-wrap')?.scrollIntoView({behavior:'smooth', block:'start'});
          });
        }
      }
    });
  };
  $scope.removeChart=i=> $scope.charts.splice(i,1);
  $scope.moveChart=(i,dir)=>{
    const j=i+dir; if(j<0||j>=$scope.charts.length) return;
    const tmp=$scope.charts[i]; $scope.charts[i]=$scope.charts[j]; $scope.charts[j]=tmp;
    $timeout(()=>{
      $scope.charts.forEach(c=> $scope.renderChart(c));
    },100);
  };
  $scope.quick=(idx,type)=>{
    const cats=$scope.cols.filter(c=>$scope.colTypes[c]==='cat');
    const col=cats[idx]||$scope.cols[idx]||$scope.cols[0];
    $scope.builder.type=type; $scope.builder.x=col; $scope.builder.agg="count"; $scope.builder.title=col+" breakdown";
    $scope.previewChart(); $scope.addChart();
  };
  $scope.scrollToBuilder=()=> document.getElementById('builder').scrollIntoView({behavior:'smooth'});
  $scope.autoGenerate=()=>{
    $scope.charts=[];
    const cats=$scope.cols.filter(c=>$scope.colTypes[c]==='cat').slice(0,4);
    cats.forEach((c,i)=>{
      const typ=i===0?'doughnut': i===1?'bar':'hbar';
      $scope.charts.push({id:"c"+Date.now()+i, title:c+" breakdown", type:typ, x:c, y:"", agg:"count", sort:true, sheet:$scope.currentSheet});
    });
    const nums=$scope.cols.filter(c=>$scope.colTypes[c]==='num');
    if(nums.length && cats.length){
      $scope.charts.push({id:"c"+Date.now()+99, title:"Avg "+nums[0]+" by "+cats[0], type:"bar", x:cats[0], y:nums[0], agg:"avg", sort:true, sheet:$scope.currentSheet});
    }
    if(!$scope.charts.length && $scope.cols.length){
      $scope.charts.push({id:"c"+Date.now(), title:$scope.cols[0]+" count", type:"bar", x:$scope.cols[0], y:"", agg:"count", sort:true, sheet:$scope.currentSheet});
    }
    $timeout(()=> $scope.charts.forEach(c=> $scope.renderChart(c)), 200);
  };

  // Bottom filters
  $scope.addFilter=()=>{
    if(!$scope.cols.length) return;
    $scope.filters.push({col:$scope.cols[0], selected:[], q:"", open:false});
  };
  $scope.removeFilter=i=>{ $scope.filters.splice(i,1); $scope.applyFilters(); };
  $scope.clearFilters=()=>{ $scope.filters=[]; $scope.globalSearch=""; $scope.applyFilters(); };
  $scope.toggleFilterValue=(f,v)=>{
    const idx=f.selected.indexOf(v);
    if(idx>-1) f.selected.splice(idx,1); else f.selected.push(v);
    $scope.applyFilters();
  };
  $scope.selectAll=f=>{
    f.selected=$scope.getUnique(f.col).slice();
    $scope.applyFilters();
  };
  $scope.onFilterColChange=f=>{
    f.selected=[]; f.q="";
  };
  $scope.applyFilters=()=>{
    let out=$scope.rawData.slice();
    const q=$scope.globalSearch.trim().toLowerCase();
    if(q){
      out=out.filter(r=> $scope.cols.some(c=> (r[c]||"").toString().toLowerCase().includes(q)));
    }
    $scope.filters.forEach(f=>{
      if(!f.selected.length) return;
      const set=new Set(f.selected);
      out=out.filter(r=> set.has((r[f.col]||"").toString().trim()));
    });
    // sort
    if($scope.sortCol){
      const c=$scope.sortCol, dir=$scope.sortDir;
      out=out.slice().sort((a,b)=>{
        const av=(a[c]||"").toString(), bv=(b[c]||"").toString();
        const an=parseFloat(av), bn=parseFloat(bv);
        if(!isNaN(an) && !isNaN(bn)) return dir==='asc'?(an-bn):(bn-an);
        return dir==='asc'? av.localeCompare(bv): bv.localeCompare(av);
      });
    }
    $scope.filtered=out;
  };
  $scope.sortBy=c=>{
    if($scope.sortCol===c) $scope.sortDir=$scope.sortDir==='asc'?'desc':'asc';
    else { $scope.sortCol=c; $scope.sortDir='asc'; }
    $scope.applyFilters();
  };
  $scope.exportFiltered=()=>{
    const rows=$scope.filtered.length? $scope.filtered : $scope.rawData;
    if(!rows.length) return alert("No rows");
    const hdr=$scope.cols.join(",");
    const csv=[hdr].concat(rows.map(r=> $scope.cols.map(c=>{
      let v=(r[c]||"").toString().replace(/"/g,'""');
      if(v.includes(",")||v.includes('"')||v.includes("\n")) v='"'+v+'"';
      return v;
    }).join(","))).join("\n");
    const blob=new Blob([csv],{type:"text/csv"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="Filtered_"+($scope.currentSheet||"data")+"_"+new Date().toISOString().slice(0,10)+".csv"; a.click();
  };
  $scope.clearAll=()=>{
    const fid=$scope.fileId;
    if(fid){
      $http.delete('/api/upload/'+fid).then(()=> console.log("deleted "+fid), ()=>{});
    }
    $scope.fileId=null; $scope.filename=""; $scope.sheets=[]; $scope.currentSheet=null;
    $scope.cols=[]; $scope.rawData=[]; $scope.filtered=[]; $scope.charts=[]; $scope.filters=[];
    const el=document.getElementById('fileInput'); if(el) el.value="";
  };

  // init filtered
  $scope.filtered=[];
});
