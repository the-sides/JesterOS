<script>
  import { onMount, tick } from 'svelte';
  import { registerMessagesAttachmentPresentation } from './messages-attachment-presentation.js';
  let { attachment, windowId, available = true, owns, ownerTarget } = $props();
  let root, audio;
  let originalAttachment, originalContents, originalWindowId;
  let mounted = false;
  const current = () => mounted && available && root?.isConnected && audio?.isConnected
    && attachment === originalAttachment && JSON.stringify(attachment) === originalContents
    && windowId === originalWindowId && owns() === true;
  onMount(() => {
    originalAttachment = attachment; originalContents = JSON.stringify(attachment); originalWindowId = windowId; mounted = true;
    const unregister = registerMessagesAttachmentPresentation(root, {
      target: Object.freeze({ ...ownerTarget, windowId, attachmentId: attachment.id }),
      describe: () => current() ? { kind: 'audio', playing: !audio.paused && !audio.ended,
        time: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : null, error: audio.error?.message ?? null } : null,
      present: async (payload, guard) => {
        if (!current() || !guard()) return false;
        const node = audio;
        if (typeof payload.time === 'number') {
          if (!Number.isFinite(node.duration) || payload.time > node.duration) return false;
          node.currentTime = payload.time;
        } else if (payload.playing === true) {
          try { await node.play(); } catch { return false; }
          if (!current() || !guard() || audio !== node) { node.pause(); return false; }
        } else if (payload.playing === false) node.pause();
        else return false;
        await tick();
        return current() && guard() && (payload.playing === undefined || node.paused === !payload.playing);
      },
    });
    return () => { mounted = false; audio?.pause(); unregister(); };
  });
</script>
<div bind:this={root} class="messages-audio-preview" data-messages-attachment-id={attachment.id}>
  <audio bind:this={audio} controls preload="metadata" src={attachment.dataURI} aria-label={attachment.name}></audio>
</div>
