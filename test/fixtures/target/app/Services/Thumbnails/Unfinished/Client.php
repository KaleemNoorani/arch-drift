<?php

namespace App\Services\Thumbnails\Unfinished;

class Client
{
    public function fetchPreview(string $assetId)
    {
        $response = $this->provider()->get("/preview/{$assetId}");
        return $response->throw()->json();
    }
}
