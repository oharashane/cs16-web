FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY unified_server.py ./
EXPOSE 3000
CMD ["uvicorn", "unified_server:APP", "--host", "0.0.0.0", "--port", "3000"]
