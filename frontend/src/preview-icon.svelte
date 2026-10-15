<script>
 let {kind,size=19}=$props();
 const paths={
  open:'M2 6h6l2 2h8v9H2V6zm0 3h16',sidebar:'M3 3h14v14H3V3zm5 0v14M5 6h1m-1 3h1m-1 3h1',
  zoomIn:'M9 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm4 10 5 5M6 9h6M9 6v6',zoomOut:'M9 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm4 10 5 5M6 9h6',
  actualSize:'M9 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm4 10 5 5M7 7l2-1v6m-2 0h4',
  rotate:'M7 3H3v4m0-4 4 4M4 9a7 7 0 1 0 6-6M9 9h6v6H9V9z',markup:'M12 4l4 4-8 8-5 1 1-5 8-8zm0 0 2-2 4 4-2 2M4 12l4 4',
  draw:'M3 16 5 11 14 2l4 4-9 9-6 1zm2-5 4 4m3-11 4 4',highlight:'M4 16h12M5 12l7-9 5 4-7 8-5-3zM5 12l-2 4h5',
  info:'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM10 8v6m0-9v.5',save:'M3 2h12l3 3v13H3V2zm3 0v6h8V2M6 18v-6h9v6',
  print:'M5 7V2h10v5M5 14H2V7h16v7h-3M5 11h10v7H5v-7zm10-2h1',search:'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm4 10 6 6',
  share:'M4 9v9h12V9M10 13V2M6 6l4-4 4 4',
  select:'M4 2v14l4-4 3 6 3-1-3-6h6L4 2z',rectangle:'M3 4h14v12H3V4z',ellipse:'M10 3a8 7 0 1 0 0 14 8 7 0 0 0 0-14z',line:'M3 17 17 3',text:'M3 4h14M10 4v13m-4 0h8',
  drawing:'M2 13c7-15 10-13 6-3s0 6 4 1 7-5 4 2',signature:'M2 16c7-3 10-19 7-12S3 18 9 14s7-4 7-1 2 2 3 0',undo:'M7 3 2 8l5 4M2 8h9a6 6 0 0 1 0 12',redo:'M13 3l5 5-5 4m5-4H9a6 6 0 0 0 0 12',trash:'M3 5h14M7 5V2h6v3M5 5l1 13h8l1-13M8 8v7m4-7v7'
 };
</script>
<svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[kind]??paths.markup}/></svg>
