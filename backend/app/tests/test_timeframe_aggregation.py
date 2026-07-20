from app.core.timeframes import aggregate_weekly

def test_aggregate_weekly_from_daily_rows():
    rows=[
        {'date':'2024-01-02','open':10,'high':12,'low':9,'close':11,'adjusted_close':11,'volume':100},
        {'date':'2024-01-03','open':11,'high':13,'low':10,'close':12,'adjusted_close':12,'volume':200},
        {'date':'2024-01-08','open':20,'high':22,'low':19,'close':21,'adjusted_close':21,'volume':300},
    ]
    out=aggregate_weekly(rows)
    assert len(out) == 2
    assert out[0]['open'] == 10
    assert out[0]['high'] == 13
    assert out[0]['low'] == 9
    assert out[0]['close'] == 12
    assert out[0]['volume'] == 300
