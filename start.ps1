Start-Process powershell -ArgumentList "-NoExit","-Command","kubectl port-forward svc/coordinator 8000:8000"
Start-Process powershell -ArgumentList "-NoExit","-Command","kubectl port-forward svc/frontend 5173:5173"
Start-Process "http://localhost:5173"