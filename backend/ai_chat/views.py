import logging

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .vanna_service import ask_question

logger = logging.getLogger(__name__)


class AskView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        question = request.data.get('question', '').strip()

        if not question:
            return Response(
                {'success': False, 'error': 'Please provide a question.'},
                status=400,
            )

        if len(question) > 1000:
            return Response(
                {'success': False, 'error': 'Question is too long. Maximum 1000 characters.'},
                status=400,
            )

        try:
            result = ask_question(question)
            status_code = 200 if result.get('success') else 400
            return Response(result, status=status_code)
        except Exception as e:
            logger.exception("Unexpected error in AskView: %s", e)
            return Response(
                {'success': False, 'error': 'An unexpected error occurred. Please try again.'},
                status=500,
            )
