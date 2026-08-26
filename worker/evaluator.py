def evaluate_answers(student_answers: list, answer_key: list):
    """Compares student answers against the answer key.
    Returns (score_out_of_10, total_questions, breakdown).

    breakdown is a list of per-question marking detail dicts, e.g.:
    [{"question": 1, "student_answer": "A", "correct_answer": "A", "is_correct": true}, ...]

    Kept modular and simple so an AI-based evaluator can be swapped in later
    without changing anything else in the worker.
    """
    total = len(answer_key)
    if total == 0:
        return 0, 0, []

    correct = 0
    breakdown = []
    for i in range(total):
        student_ans = student_answers[i].strip().upper() if i < len(student_answers) else ""
        correct_ans = answer_key[i].strip().upper()
        is_correct = student_ans == correct_ans
        if is_correct:
            correct += 1
        breakdown.append(
            {
                "question": i + 1,
                "student_answer": student_ans or "-",
                "correct_answer": correct_ans,
                "is_correct": is_correct,
            }
        )

    score = correct
    return score, total, breakdown
