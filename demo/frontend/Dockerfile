# Reproducible build of the demo, for maintenance without a local Node install.
#
# Build the site (context = REPO ROOT, because the build reads demo/experiments/):
#   docker build -f demo/frontend/Dockerfile -t sum-bike-demo .
# Serve it on http://localhost:8080 :
#   docker run --rm -p 8080:80 sum-bike-demo
# Extract dist/ instead of serving it:
#   docker build -f demo/frontend/Dockerfile --target build -t sum-bike-build .
#   docker run --rm -v "$PWD/out:/out" sum-bike-build sh -c "cp -r /app/demo/frontend/dist/. /out"

FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so the layer caches independently of the data.
COPY demo/frontend/package.json demo/frontend/package-lock.json ./demo/frontend/
RUN cd demo/frontend && npm ci

# The experiment layer is an INPUT to the build: prepare-data.mjs reads it on prebuild.
COPY demo/experiments/scenarios ./demo/experiments/scenarios
COPY demo/experiments/results ./demo/experiments/results
COPY demo/experiments/data ./demo/experiments/data
COPY demo/frontend ./demo/frontend

ARG SITE=https://inria.github.io
ARG BASE=/inocs-sum-bss-pt-network-design
ENV SITE=$SITE BASE=$BASE
RUN cd demo/frontend && npm run build

FROM nginx:alpine AS serve
COPY --from=build /app/demo/frontend/dist /usr/share/nginx/html/inocs-sum-bss-pt-network-design
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location = / { return 302 /inocs-sum-bss-pt-network-design/; }\n}\n' \
    > /etc/nginx/conf.d/default.conf
EXPOSE 80
