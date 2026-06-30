FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libpq-dev gcc cron \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x entrypoint.sh

RUN python manage.py collectstatic --noinput

EXPOSE 8000

# Entrypoint starts cron + gunicorn together (see entrypoint.sh). Defined here
# so scheduled jobs run even when the platform launches the image via this CMD
# (e.g. Dokploy building from the Dockerfile) rather than a compose override.
CMD ["./entrypoint.sh"]
