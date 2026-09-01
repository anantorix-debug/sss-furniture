@echo off
REM Start Docker Desktop
echo Starting Docker Desktop...
start "" "C:\Program Files\Docker\Docker\Docker.exe"

REM Wait for Docker to be ready
echo Waiting for Docker daemon to start (this may take 1-2 minutes)...
:wait_docker
docker info >nul 2>&1
if errorlevel 1 (
    timeout /t 5 /nobreak
    goto wait_docker
)

echo Docker is ready!
echo Starting all services...

REM Start all services
docker-compose up -d

REM Show status
echo.
echo All services started!
echo.
docker-compose ps
echo.
echo Access the app at:
echo   Web: http://localhost:3000
echo   API: http://localhost:4000
echo.
echo View logs with: docker-compose logs -f
pause
