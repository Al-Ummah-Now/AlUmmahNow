# FFmpeg transcoder for apps/media (Cloudflare Containers, linux/amd64).
# Node runs the job server; ffmpeg/ffprobe come from Alpine (libx264, AAC, libwebp).
FROM node:22-alpine
RUN apk add --no-cache ffmpeg && ffmpeg -hide_banner -encoders | grep -q libx264 && ffmpeg -hide_banner -encoders | grep -q libwebp
WORKDIR /app
COPY ladder.mjs rungs.mjs server.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
