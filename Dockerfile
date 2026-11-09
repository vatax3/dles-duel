FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data TZ=Europe/Paris
RUN apk add --no-cache tzdata su-exec && mkdir -p /data
WORKDIR /app
COPY package.json server.js docker-entrypoint.sh ./
COPY public ./public
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
