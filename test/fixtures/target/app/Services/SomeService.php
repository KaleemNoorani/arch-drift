<?php

namespace App\Services;

use App\Models\FulfillmentOrder;

class SomeService
{
    public function createAdHoc(array $data)
    {
        // Bug: bypasses the ingest boundary entirely.
        $order = new FulfillmentOrder($data);
        $order->save();

        return $order;
    }
}
