import pytest
from app.models import CHUNK_SIZE, chunk_count, chunk_range


@pytest.mark.parametrize("size", [0, 1, CHUNK_SIZE-1, CHUNK_SIZE, CHUNK_SIZE+1, 2621440, 5*1024**3+17, 100*1024**3])
def test_coverage(size):
    cursor = 0
    for index in range(chunk_count(size)):
        start, end = chunk_range(size, index)
        assert start == cursor
        assert 0 < end-start+1 <= CHUNK_SIZE
        if index < chunk_count(size)-1:
            assert end-start+1 == CHUNK_SIZE
        cursor = end+1
    assert cursor == size


def test_final_range():
    assert chunk_range(2621440, 2) == (2097152, 2621439)
    assert chunk_count(0) == 0
    with pytest.raises(ValueError):
        chunk_range(0, 0)
    with pytest.raises(ValueError):
        chunk_count(-1)
