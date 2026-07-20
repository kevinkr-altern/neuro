from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.db import init_db
from app.api.routes import router

app = FastAPI(title='Setup-Miner API')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

@app.on_event('startup')
def startup(): init_db()

app.include_router(router, prefix='/api')
