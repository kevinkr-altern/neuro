from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from starlette.staticfiles import StaticFiles
from app.core.db import init_db
from app.api.routes import router

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(title='Setup-Miner API', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])
app.include_router(router, prefix='/api')

_STATIC_DIR = Path(__file__).parent / 'static'
_UI = _STATIC_DIR / 'index.html'

# css/js/vendor werden als eigene Dateien ausgeliefert (kein Build-Schritt,
# nur mehrere <script>/<link>-Tags in index.html).
app.mount('/static', StaticFiles(directory=_STATIC_DIR), name='static')

@app.get('/', response_class=HTMLResponse)
def home():
    return _UI.read_text(encoding='utf-8')
