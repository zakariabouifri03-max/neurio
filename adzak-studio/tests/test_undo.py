from adzak.core.undo import Command, UndoStack


def test_undo_redo_cycle():
    state = {"v": 0}
    stack = UndoStack()
    stack.push(Command("set 5", lambda: state.update(v=5), lambda: state.update(v=0)))
    assert state["v"] == 5
    assert stack.undo()
    assert state["v"] == 0
    assert stack.redo()
    assert state["v"] == 5
    assert not stack.redo()


def test_new_command_clears_redo():
    state = {"v": 0}
    stack = UndoStack()
    stack.push(Command("a", lambda: state.update(v=1), lambda: state.update(v=0)))
    stack.undo()
    assert stack.can_redo()
    stack.push(Command("b", lambda: state.update(v=9), lambda: state.update(v=0)))
    assert not stack.can_redo()


def test_limit():
    stack = UndoStack(limit=3)
    for i in range(10):
        stack.push(Command(str(i), lambda: None, lambda: None), execute=False)
    assert len(stack._undo) == 3
    assert stack.undo_label() == "9"
