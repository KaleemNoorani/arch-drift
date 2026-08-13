<?php

namespace App\Services\Legacy;

use App\Models\FulfillmentOrder;

class OrderBackfill
{
    public function run(array $rows)
    {
        foreach ($rows as $row) {
            FulfillmentOrder::create($row);
        }
    }
}
