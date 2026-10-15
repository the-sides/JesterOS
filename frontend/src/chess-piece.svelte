<script>
 let {piece='',material='wood'}=$props();
 const shapes={p:'M21 49 L25 42 L27 32 Q20 29 22 23 Q24 17 30 17 Q36 17 38 23 Q40 29 33 32 L35 42 L39 49 Z',r:'M19 49 L22 42 L24 25 L20 23 L20 14 L26 14 L26 19 L29 19 L29 14 L33 14 L33 19 L36 19 L36 14 L41 14 L41 23 L36 25 L38 42 L41 49 Z',n:'M18 49 L22 42 L27 35 L20 34 L20 28 L24 22 L27 15 L32 18 L36 20 Q43 29 39 41 L42 49 Z M24 25 L27 25',b:'M20 49 L25 41 L27 31 Q19 26 25 18 L30 10 L35 18 Q41 25 34 31 L36 41 L40 49 Z M31 17 L27 26',q:'M18 49 L22 40 L23 31 L18 19 L26 24 L30 12 L34 24 L42 19 L38 31 L39 40 L43 49 Z',k:'M19 49 L23 40 L25 30 L21 26 L24 19 L28 19 L28 13 L24 13 L24 9 L28 9 L28 5 L33 5 L33 9 L37 9 L37 13 L33 13 L33 19 L37 19 L40 26 L35 30 L37 40 L41 49 Z'};
 let light=$derived(piece===piece.toUpperCase());
</script>
<svg class="chess-piece" class:ivory={light} class:ebony={!light} class:metal={material==='metal'} viewBox="0 0 60 60" aria-hidden="true">
 <ellipse cx="32" cy="53" rx="23" ry="5" fill="#000" opacity=".32"/>
 <path d={shapes[piece.toLowerCase()]??''} fill="currentColor" stroke={light?'#6c4b29':'#140d09'} stroke-width="1.7" stroke-linejoin="round"/>
 <path d="M19 49 Q30 45 42 49 L44 53 Q30 58 16 53 Z" fill="currentColor" stroke={light?'#6c4b29':'#140d09'} stroke-width="1.7"/>
 <path d="M24 43 Q30 41 36 43 M23 49 Q30 47 39 49" fill="none" stroke={light?'#fff2cc':'#b98a5d'} stroke-opacity=".52" stroke-width="2"/>
 {#if piece.toLowerCase()==='n'}<circle cx="29" cy="24" r="1.7" fill={light?'#382419':'#e5c7a0'}/>{/if}
</svg>
<style>
 .chess-piece{display:block;width:90%;height:100%;margin:auto;color:#c99a5a;filter:drop-shadow(2px 1px 1px #0005)}.chess-piece.ebony{color:#59351f}.chess-piece.metal.ivory{color:#dadbdd}.chess-piece.metal.ebony{color:#565b63}
</style>
