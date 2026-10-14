import pytest
from app.models import CHUNK_SIZE, chunk_count, chunk_range


@pytest.mark.parametrize(
    "size",
    [
        0,
        1,
        CHUNK_SIZE - 1,
        CHUNK_SIZE,
        CHUNK_SIZE + 1,
        2621440,
        4 * 1024**3 + 33,
        100 * 1024**3 + 999,
    ],
)
def test_exact_coverage(size):
    end = -1
    total = 0
    for index in range(chunk_count(size)):
        start, next_end = chunk_range(index, size)
        assert start == end + 1
        assert 0 < next_end - start + 1 <= CHUNK_SIZE
        if index < chunk_count(size) - 1:
            assert next_end - start + 1 == CHUNK_SIZE
        end = next_end
        total += next_end - start + 1
    assert total == size
    assert end == size - 1


def test_example():
    assert [chunk_range(i, 2621440) for i in range(3)] == [
        (0, 1048575),
        (1048576, 2097151),
        (2097152, 2621439),
    ]
    with pytest.raises(IndexError):
        chunk_range(0, 0)
    with pytest.raises(ValueError):
        chunk_count(-1)
