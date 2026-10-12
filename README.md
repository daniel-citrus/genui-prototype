# genui-prototype

Vite + TypeScript starter with Docker for dev and production.

Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Tracked work: [plans](docs/plans/), [goals](docs/goals/), [milestones](docs/milestones/), [abandoned](docs/abandoned/).

## Local (Node 24+)

```bash
npm ci
npm run dev
```

Open http://localhost:5173

```bash
npm run build    # dist/
npm run preview  # serve dist on :4173
npm run typecheck
```

## Docker

**Development** (Vite HMR, source mounted):

```bash
docker compose up dev
```

**Production** (build + nginx):

```bash
docker compose up web --build
```

Open http://localhost:8080

Or build and run the image directly:

```bash
docker build -t genui-prototype .
docker run --rm -p 8080:80 genui-prototype
```
