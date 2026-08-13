<?php

namespace App\Services\Integrations\QuickCommerce;

use App\Models\FulfillmentOrder;

class IngestOrders
{
    public function materialize(array $payload)
    {
        return FulfillmentOrder::create($payload);
    }
}
